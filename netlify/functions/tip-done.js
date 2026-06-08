// ════════════════════════════════════════════
// DESPY — Validation d'un conseil hebdomadaire
// Appelé via le bouton « ✅ C'est fait » dans l'email (lien GET signé).
// 1. Vérifie le jeton (anti-triche)
// 2. Marque le conseil comme accompli dans weekly_tip_log
// 3. Affiche une page « Bravo ! » rassurante
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { TIPS_BY_ID } = require('./_weekly-tips');

function makeToken(email, tipId) {
  const secret = process.env.INTERNAL_SECRET || process.env.SUPABASE_SERVICE_KEY || 'despy';
  return crypto.createHmac('sha256', secret)
    .update((email || '').toLowerCase() + '|' + tipId)
    .digest('hex')
    .slice(0, 32);
}

function tokenValid(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch (e) { return false; }
}

function page(title, message, accent) {
  const color = accent || '#16a34a';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Despy</title></head>
<body style="margin:0;background:#eef1f6;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:60px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(10,31,58,.12)">
    <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:30px;text-align:center;color:#fff">
      <div style="font-size:13px;font-weight:700;opacity:.7;letter-spacing:2px">DESPY</div>
    </div>
    <div style="padding:36px 30px;text-align:center">
      <div style="font-size:54px;line-height:1;margin-bottom:14px">${accent === '#dc2626' ? '🤔' : '🎉'}</div>
      <h1 style="font-size:22px;color:${color};margin:0 0 14px">${title}</h1>
      <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 26px">${message}</p>
      <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Retour sur Despy</a>
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
  const tipId = qs.t;
  const token = qs.k;

  if (!email || !tipId || !token) {
    return html(400, page('Lien incomplet', "Ce lien semble incomplet. Revenez à votre email Despy et cliquez à nouveau sur le bouton vert.", '#dc2626'));
  }

  // Jeton invalide → on refuse poliment (pas de fuite d'info).
  if (!tokenValid(token, makeToken(email, tipId))) {
    return html(403, page('Lien non valide', "Ce lien n'est plus valide. Pas d'inquiétude : il vous suffit de cliquer depuis votre email Despy le plus récent.", '#dc2626'));
  }

  const tip = TIPS_BY_ID[tipId];
  const tipTitre = tip ? tip.titre : 'ce conseil';

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('weekly_tip_log').upsert(
      {
        email: email.toLowerCase().trim(),
        tip_id: tipId,
        completed_at: new Date().toISOString()
      },
      { onConflict: 'email,tip_id' }
    );

    return html(200, page(
      'Bravo, c\'est noté !',
      `Vous avez mis en place : <strong>${tipTitre}</strong>.<br><br>Despy s'en souvient et ne vous renverra plus ce conseil. La semaine prochaine, on passe au suivant. Chaque geste vous rend plus difficile à pirater 🛡️`
    ));
  } catch (err) {
    console.error('tip-done error:', err.message);
    // On reste rassurant même en cas d'erreur technique.
    return html(200, page(
      'Bien reçu !',
      "Merci d'avoir mis en place ce conseil. Continuez ainsi, chaque petit geste compte pour votre sécurité 🛡️"
    ));
  }
};
