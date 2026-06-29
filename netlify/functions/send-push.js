// ════════════════════════════════════════════
// DESPY — Envoi d'une notification push CIBLÉE (un membre précis)
// POST { email, title, body, url } + header x-internal-secret
//
// Cible tous les appareils abonnés liés à cet email (table
// push_subscriptions, colonne email renseignée à l'abonnement).
// Réutilise le pattern web-push éprouvé de national-alerts.js.
//
// Appelée en interne par hibp-check.js et hudsonrock-check.js dès qu'une
// NOUVELLE fuite / infection est détectée → alerte instantanée sur le
// téléphone, en plus de l'email détaillé.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  // Appel interne uniquement (même protection que send-email.js)
  const secret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
  if (!process.env.INTERNAL_SECRET || secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const email = (body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@') || !body.title) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid' }) };
  }

  // VAPID non configuré → on échoue en douceur (l'email reste le canal fiable)
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, error: 'vapid_unconfigured' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Tous les appareils de ce membre (ciblage par email)
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('email', email);

    if (error || !subs || subs.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, failed: 0 }) };
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contact@despy.fr',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const payload = JSON.stringify({
      title: body.title.length > 80 ? body.title.slice(0, 77) + '…' : body.title,
      body: body.body || '',
      url: body.url || 'https://despy.fr',
      tag: 'despy-perso-' + Buffer.from(email).toString('base64').slice(0, 20)
    });

    let sent = 0, failed = 0;
    const expired = [];
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
        if (e.statusCode === 404 || e.statusCode === 410) expired.push(sub.endpoint);
      }
    }

    // Nettoyer les abonnements expirés (appareil/navigateur désabonné)
    if (expired.length > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expired);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ sent, failed, cleaned: expired.length }) };
  } catch (err) {
    console.error('send-push error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
