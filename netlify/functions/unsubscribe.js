// ════════════════════════════════════════════
// DESPY — Désinscription des conseils hebdomadaires
// Lien GET signé, placé en pied de chaque conseil.
// N'affecte PAS le statut d'abonné payant (table email_optouts dédiée).
//  ?action=resub → réabonnement en un clic.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function makeToken(email, purpose) {
  const secret = process.env.INTERNAL_SECRET || process.env.SUPABASE_SERVICE_KEY || 'despy';
  return crypto.createHmac('sha256', secret)
    .update((email || '').toLowerCase() + '|' + purpose)
    .digest('hex')
    .slice(0, 32);
}

function tokenValid(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch (e) { return false; }
}

function page(emoji, title, message, accent, ctaHtml) {
  const color = accent || '#2D5BFF';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Despy</title></head>
<body style="margin:0;background:#eef1f6;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:60px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(10,31,58,.12)">
    <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:30px;text-align:center;color:#fff">
      <div style="font-size:13px;font-weight:700;opacity:.7;letter-spacing:2px">DESPY</div>
    </div>
    <div style="padding:36px 30px;text-align:center">
      <div style="font-size:54px;line-height:1;margin-bottom:14px">${emoji}</div>
      <h1 style="font-size:22px;color:${color};margin:0 0 14px">${title}</h1>
      <p style="font-size:16px;color:#444;line-height:1.7;margin:0 0 26px">${message}</p>
      ${ctaHtml || ''}
    </div>
    <p style="font-size:11px;color:#aaa;text-align:center;padding:0 0 22px;margin:0">Despy · despy.fr</p>
  </div>
</body></html>`;
}

exports.handler = async (event) => {
  const html = (code, body) => ({
    statusCode: code,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body
  });

  const qs = event.queryStringParameters || {};
  const email = qs.e;
  const token = qs.k;
  const action = qs.action === 'resub' ? 'resub' : 'unsub';

  if (!email || !token) {
    return html(400, page('🤔', 'Lien incomplet', "Ce lien semble incomplet. Revenez à votre email Despy et cliquez à nouveau.", '#dc2626'));
  }
  if (!tokenValid(token, makeToken(email, 'unsub'))) {
    return html(403, page('🤔', 'Lien non valide', "Ce lien n'est plus valide. Cliquez depuis votre email Despy le plus récent.", '#dc2626'));
  }

  const cleanEmail = email.toLowerCase().trim();
  const baseUrl = process.env.URL || 'https://despy.fr';

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    if (action === 'resub') {
      await supabase.from('email_optouts').delete().eq('email', cleanEmail);
      return html(200, page(
        '🎉', 'Vous êtes réabonné !',
        "Parfait, vous recevrez à nouveau votre conseil sécurité chaque semaine. Content de vous retrouver 🛡️",
        '#16a34a',
        `<a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Retour sur Despy</a>`
      ));
    }

    // Désinscription
    await supabase.from('email_optouts').upsert(
      { email: cleanEmail, scope: 'weekly', created_at: new Date().toISOString() },
      { onConflict: 'email' }
    );
    const resubUrl = `${baseUrl}/.netlify/functions/unsubscribe?e=${encodeURIComponent(email)}&k=${token}&action=resub`;
    return html(200, page(
      '👋', "C'est fait, vous êtes désinscrit",
      "Vous ne recevrez plus les conseils hebdomadaires.<br><br><strong>Votre abonnement Despy n'est pas affecté</strong> : votre protection, vos alertes et votre Conseiller restent actifs.",
      '#2D5BFF',
      `<a href="${resubUrl}" style="background:#16a34a;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Finalement, je me réabonne</a>`
    ));

  } catch (err) {
    console.error('unsubscribe error:', err.message);
    return html(200, page(
      '👋', 'Demande prise en compte',
      "Votre demande a bien été enregistrée. Si vous receviez encore un conseil, écrivez-nous à contact@despy.fr.",
      '#2D5BFF'
    ));
  }
};
