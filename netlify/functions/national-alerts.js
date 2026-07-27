// ════════════════════════════════════════════
// DESPY — Push d'alertes nationales
// Cron : 2 fois par jour → 0 9,18 * * * (voir netlify.toml)
// 1. RSS ANSSI (CERT-FR)
// 2. Vagues d'arnaques détectées via analyses_history (≥3 fois en 48h)
// 3. Push à toutes les subscriptions actives (abonnés ou gratuits)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

async function fetchAnssiRss() {
  try {
    const res = await fetch('https://www.cert.ssi.gouv.fr/feed/', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Despy/1.0' }
    });
    if (!res.ok) return [];
    const xml = await res.text();
    // Parse minimal du RSS (titre + lien des 5 derniers items)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRegex.exec(xml)) && items.length < 5) {
      const block = m[1];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?<\/title>/i) || [])[1];
      const link = (block.match(/<link>([^<]+)<\/link>/i) || [])[1];
      const pubDate = (block.match(/<pubDate>([^<]+)<\/pubDate>/i) || [])[1];
      if (title && link) {
        items.push({
          title: title.trim(),
          url: link.trim(),
          source: 'ANSSI',
          published: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
        });
      }
    }
    return items;
  } catch (e) {
    console.error('ANSSI RSS error:', e.message);
    return [];
  }
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

// Ne garder que les alertes pertinentes pour le grand public senior.
// Les vagues d'arnaques détectées en interne passent toujours.
// Les avis ANSSI purement techniques (CVE, vulnérabilités produits) sont écartés.
function isPublicRelevant(alert) {
  const source = (alert.source || '').toUpperCase();
  if (source.indexOf('ANSSI') === -1) return true; // vagues internes = pertinentes
  // Pour l'ANSSI : uniquement le contenu qui parle réellement au grand public.
  // Les bulletins/avis techniques (CVE, "Vulnérabilité dans X", etc.) sont écartés.
  const text = ((alert.title || '') + ' ' + (alert.body || '')).toLowerCase();
  const KEYWORDS = [
    'phishing', 'hameçonnage', 'hameconnage', 'arnaque', 'fraude', 'escroquerie', 'escroc',
    'smishing', 'vishing', 'faux sms', 'faux courriel', 'faux mail', 'usurpation',
    'rançongiciel', 'rancongiciel', 'vol de données', 'vol de donnees',
    'fuite de données', 'fuite de donnees', 'démarchage', 'demarchage',
    'faux support', 'faux conseiller', 'carte bancaire', 'compte bancaire'
  ];
  return KEYWORDS.some(k => text.indexOf(k) !== -1);
}

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement (pas d'appel HTTP)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Récupérer alertes externes + internes
    const [anssi, internal] = await Promise.all([
      fetchAnssiRss(),
      detectInternalWaves(supabase)
    ]);
    // Filtre grand public : on écarte le jargon technique (CVE, etc.)
    const allAlerts = [...internal, ...anssi].filter(isPublicRelevant);

    // 2. Filtrer celles déjà envoyées (basé sur table national_alerts)
    const newAlerts = [];
    for (const alert of allAlerts) {
      const { data: exists } = await supabase
        .from('national_alerts')
        .select('id')
        .eq('url', alert.url)
        .maybeSingle();
      if (!exists) newAlerts.push(alert);
    }

    if (newAlerts.length === 0) {
      console.log('Aucune nouvelle alerte');
      return { statusCode: 200, body: JSON.stringify({ new: 0 }) };
    }

    // 3. Pour chaque nouvelle alerte : sauver + envoyer push
    const results = [];
    for (const alert of newAlerts.slice(0, 3)) { // Max 3 push par run
      await supabase.from('national_alerts').insert({
        title: alert.title,
        body: alert.body || '',
        source: alert.source,
        url: alert.url,
        created_at: new Date().toISOString()
      });
      const r = await sendPushToAll(supabase, alert);
      results.push({ title: alert.title, ...r });
    }

    console.log('Alertes envoyées:', results);
    return { statusCode: 200, body: JSON.stringify({ new: newAlerts.length, results }) };

  } catch (err) {
    console.error('national-alerts error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
