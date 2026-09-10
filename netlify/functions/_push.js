// ════════════════════════════════════════════
// DESPY — Envoi d'une notification à tous les appareils enregistrés
//
// Extrait de national-alerts.js, où cette plomberie vivait seule. « Publier et
// prévenir » en a besoin aussi, et recopier quarante lignes de web-push, c'est
// se garantir qu'un jour l'une des deux copies nettoiera les abonnements
// expirés et pas l'autre.
//
// Volontairement bas niveau : l'appelant fournit le texte déjà composé. Le
// titre d'une alerte de prévention n'est pas celui d'un article de presse, et
// c'est à celui qui sait pourquoi il notifie de l'écrire.
// ════════════════════════════════════════════

const webpush = require('web-push');

// payload : { title, body, url, tag }
// Renvoie { sent, failed, cleaned }. Ne lève jamais : une notification est un
// bonus, elle ne doit pas faire échouer ce qui l'entoure.
async function envoyerPush(supabase, payload) {
  try {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      console.warn('[push] clés VAPID absentes — aucune notification envoyée');
      return { sent: 0, failed: 0, cleaned: 0, probleme: 'vapid_absent' };
    }

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth');
    if (error || !subs || subs.length === 0) return { sent: 0, failed: 0, cleaned: 0 };

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contact@despy.fr',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const corps = JSON.stringify({
      title: (payload.title || 'Despy').slice(0, 80),
      body: payload.body || '',
      url: payload.url || 'https://despy.fr',
      tag: payload.tag || 'despy'
    });

    let sent = 0, failed = 0;
    const expires = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          corps,
          { TTL: 24 * 3600 }
        );
        sent++;
      } catch (e) {
        failed++;
        // 404/410 = l'appareil a désinstallé l'appli ou vidé ses données.
        // Sans ce nettoyage, la liste ne fait que grossir et chaque passage
        // ultérieur perd du temps sur des adresses mortes.
        if (e.statusCode === 404 || e.statusCode === 410) expires.push(sub.endpoint);
      }
    }

    if (expires.length > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expires);
    }

    return { sent, failed, cleaned: expires.length };
  } catch (e) {
    console.error('[push] échec global:', e && e.message);
    return { sent: 0, failed: 0, cleaned: 0, probleme: (e && e.message) || 'inconnu' };
  }
}

// Étiquette stable pour qu'une même alerte ne s'empile pas en double sur
// l'écran de verrouillage si elle est notifiée deux fois.
function tagDepuis(cle) {
  return 'despy-' + Buffer.from(String(cle || 'despy')).toString('base64').slice(0, 24);
}

module.exports = { envoyerPush, tagDepuis };
