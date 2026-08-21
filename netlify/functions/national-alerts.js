// ════════════════════════════════════════════
// DESPY — Push d'alertes nationales
// Cron : 2 fois par jour → 0 9,18 * * * (voir netlify.toml)
// 1. Sources publiques françaises (CNIL, Cybermalveillance, ANSSI)
//    → voir _alert-sources.js, qui décide aussi de ce qui parle à un senior
// 2. Vagues d'arnaques détectées via analyses_history (≥3 fois en 48h)
// 3. Push à toutes les subscriptions actives (abonnés ou gratuits)
//
// Historique : ce robot n'a jamais rien envoyé. Il n'interrogeait que le
// CERT-FR, qui ne publie que des avis de failles logicielles destinés aux
// administrateurs système — aucun ne pouvait passer un filtre grand public.
// Les sources vivent désormais dans _alert-sources.js, partagé avec
// cyber-alerts.js et list-alerts.js pour qu'il n'existe qu'une définition.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const { collecterAlertes } = require('./_alert-sources');

// On ne stocke que ce qui a moins de 120 jours : au-delà, ce n'est plus une
// alerte, c'est de l'archive — et l'afficher comme « en ce moment » serait faux.
const FENETRE_JOURS = 120;

// Une notification push ne se justifie que pour un événement récent. Sans ce
// garde-fou, la toute première exécution réveillerait tout le monde avec des
// articles de plusieurs mois.
const PUSH_JOURS = 12;

function recente(alerte, jours) {
  if (!alerte.published) return false;
  const t = new Date(alerte.published).getTime();
  return !isNaN(t) && t >= Date.now() - jours * 24 * 3600 * 1000;
}

async function detectInternalWaves(supabase) {
  // Cherche les domaines/numéros récurrents dans analyses_history des dernières 48h
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: rows } = await supabase
    .from('analyses_history')
    .select('content, verdict, signals')
    .eq('verdict', 'scam')
    .gte('created_at', since)
    .limit(500);
  if (!rows || rows.length < 3) return [];

  // Extraire les domaines mentionnés
  const domainCount = {};
  rows.forEach(r => {
    const matches = (r.content || '').match(/[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s)>"']*)?/gi) || [];
    matches.forEach(m => {
      const dom = m.split('/')[0].toLowerCase();
      // Ignorer les TLD légitimes connus
      if (/(laposte|chronopost|amazon|leboncoin|fnac|sncf|cdiscount|bnpparibas|creditmutuel|lcl|hsbc|despy)\.[a-z]{2,}/i.test(dom)) return;
      domainCount[dom] = (domainCount[dom] || 0) + 1;
    });
  });

  const waves = [];
  Object.entries(domainCount)
    .filter(([_, c]) => c >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .forEach(([dom, count]) => {
      waves.push({
        title: `Vague d'arnaque détectée : ${dom}`,
        url: 'https://despy.fr/#analyseur',
        source: 'Despy Community',
        body: `${count} signalements en 48h pour ce domaine. Ne cliquez sur aucun lien le contenant.`,
        published: new Date().toISOString()
      });
    });
  return waves;
}

async function sendPushToAll(supabase, alert) {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth');
  if (error || !subs || subs.length === 0) return { sent: 0, failed: 0 };

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:contact@despy.fr',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const payload = JSON.stringify({
    title: alert.title.length > 80 ? alert.title.slice(0, 77) + '…' : alert.title,
    body: alert.body || ('Source : ' + (alert.source || 'Despy')),
    url: alert.url || 'https://despy.fr',
    tag: 'despy-' + Buffer.from(alert.url || alert.title).toString('base64').slice(0, 24)
  });

  let sent = 0, failed = 0;
  const expiredEndpoints = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 24 * 3600 }
      );
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) expiredEndpoints.push(sub.endpoint);
    }
  }

  // Nettoyer les subscriptions expirées
  if (expiredEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
  }

  return { sent, failed, cleaned: expiredEndpoints.length };
}

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement (pas d'appel HTTP)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Récupérer alertes externes (déjà filtrées grand public) + internes
    const [externes, internes] = await Promise.all([
      collecterAlertes(FENETRE_JOURS),
      detectInternalWaves(supabase)
    ]);
    const toutes = [...internes, ...externes];
    console.log(`[alertes] ${externes.length} externes retenues, ${internes.length} vagues internes`);

    // 2. Écarter celles déjà connues (table national_alerts)
    const nouvelles = [];
    for (const alerte of toutes) {
      const { data: existe } = await supabase
        .from('national_alerts')
        .select('id')
        .eq('url', alerte.url)
        .maybeSingle();
      if (!existe) nouvelles.push(alerte);
    }

    if (nouvelles.length === 0) {
      console.log('[alertes] aucune nouveauté');
      return { statusCode: 200, body: JSON.stringify({ new: 0 }) };
    }

    // 3. Enregistrer TOUTES les nouvelles (l'appli les affichera), mais ne
    //    notifier que les récentes : on enregistre l'historique sans réveiller
    //    les gens pour un article de trois mois.
    const resultats = [];
    let notifiees = 0;
    for (const alerte of nouvelles) {
      const { error } = await supabase.from('national_alerts').insert({
        title: alerte.title,
        body: alerte.body || '',
        source: alerte.source,
        url: alerte.url,
        created_at: alerte.published || new Date().toISOString()
      });
      // Bruyant : une insertion muette est ce qui a masqué le problème avant.
      if (error) {
        console.error('[alertes] insertion impossible:', error.message, '—', alerte.title);
        continue;
      }
      if (notifiees < 2 && recente(alerte, PUSH_JOURS)) {
        const r = await sendPushToAll(supabase, alerte);
        resultats.push({ title: alerte.title, ...r });
        notifiees++;
      }
    }

    console.log('[alertes] enregistrées:', nouvelles.length, '| push:', resultats);
    return { statusCode: 200, body: JSON.stringify({ new: nouvelles.length, pushed: resultats }) };

  } catch (err) {
    console.error('national-alerts error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
