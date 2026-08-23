// ════════════════════════════════════════════
// DESPY — Push d'alertes nationales
// Cron : 2 fois par jour → 0 9,18 * * * (voir netlify.toml)
// 1. Sources publiques françaises (CNIL, Cybermalveillance, ANSSI)
//    → voir _alert-sources.js, qui décide aussi de ce qui parle à un senior
// 2. Vagues d'arnaques chez nos propres membres → voir _vagues.js
// 3. Fiches d'arnaques de saison → voir _calendrier-arnaques.js
// 4. Push à toutes les subscriptions actives (abonnés ou gratuits)
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
const { fichesAPublier } = require('./_calendrier-arnaques');
const { detecterVagues } = require('./_vagues');

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
    // 1. Alertes externes (déjà filtrées grand public), vagues internes, et
    //    fiches de saison (voir _calendrier-arnaques.js).
    const [externes, vagues, saison] = await Promise.all([
      collecterAlertes(FENETRE_JOURS),
      detecterVagues(supabase),
      fichesAPublier(supabase)
    ]);
    const toutes = externes;
    console.log(`[alertes] ${externes.length} externes retenues, ${vagues.length} vagues internes,`
      + ` ${saison.length} fiche(s) de saison`);

    // 2. Écarter celles déjà connues (table national_alerts)
    //
    // `limit(1)` et non `maybeSingle()` : cette dernière lève une erreur dès
    // que DEUX lignes portent la même URL. Or nos propres publications en
    // partagent forcément — les vagues pointent toutes vers la page d'alertes,
    // et trois fiches de saison mènent à impots.gouv.fr. La lecture ne doit pas
    // dépendre d'une unicité que nos données ne respectent pas.
    const nouvelles = [];
    for (const alerte of toutes) {
      const { data: existe } = await supabase
        .from('national_alerts')
        .select('id')
        .eq('url', alerte.url)
        .limit(1);
      if (!existe || !existe.length) nouvelles.push(alerte);
    }

    // Vagues et fiches de saison ne passent pas par ce dédoublonnage-là : elles
    // partagent toutes la même URL, et dédoublonner par URL n'en aurait laissé
    // passer qu'une seule dans toute la vie du service. Elles se dédoublonnent
    // par TITRE, en amont, chacune dans son module.
    //
    // Ordre : une vague en cours d'abord — elle touche nos membres aujourd'hui —
    // puis la fiche de saison, puis les communiqués qui décrivent ce qui est
    // déjà arrivé.
    nouvelles.unshift(...vagues, ...saison);

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
