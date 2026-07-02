// ════════════════════════════════════════════
// DESPY — Mot de passe oublié (étape 1 : envoi du lien)
// POST { email }
//
// Envoie un email avec un lien de réinitialisation valable 30 minutes.
// Réponse TOUJOURS neutre (« si un compte existe, un email a été envoyé »)
// pour ne jamais révéler si un email est client ou non.
//
// Le jeton est signé HMAC (même secret que _auth.js) mais préfixé
// « pwreset » : il ne peut PAS servir de jeton de session, et un jeton
// de session ne peut pas servir à changer un mot de passe.
// ════════════════════════════════════════════

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { rateLimit } = require('./_auth');

const SECRET = process.env.AUTH_TOKEN_SECRET || process.env.INTERNAL_SECRET || '';
const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function issueResetToken(email) {
  const payload = `pwreset|${String(email).toLowerCase().trim()}|${Date.now() + RESET_TTL_MS}`;
  return `${b64url(payload)}.${sign(payload)}`;
}

function buildResetEmailHTML(prenom, link) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
      <div style="background:#010410;padding:18px 28px;text-align:center">
        <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="110" style="width:110px;max-width:45%;height:auto;display:inline-block;border:0">
      </div>
      <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
      <div style="background:#0b1230;padding:22px 28px;color:#fff">
        <div style="font-size:11px;font-weight:700;opacity:.8;letter-spacing:2px">DESPY — VOTRE COMPTE</div>
        <div style="font-size:22px;font-weight:900;margin-top:6px">🔑 Réinitialiser votre mot de passe</div>
      </div>
      <div style="padding:28px">
        <p style="font-size:16px;color:#111">Bonjour <strong>${prenom}</strong>,</p>
        <p style="font-size:14px;color:#555;line-height:1.7">
          Vous avez demandé à changer votre mot de passe Despy. Cliquez sur le bouton
          ci-dessous, puis choisissez votre nouveau mot de passe. Ce lien est valable
          <strong>30 minutes</strong>.
        </p>
        <div style="text-align:center;margin:26px 0">
          <a href="${link}" style="background:#2D5BFF;color:#fff;padding:16px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
            Choisir mon nouveau mot de passe →
          </a>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin:18px 0">
          <p style="font-size:13px;color:#555;margin:0;line-height:1.7">
            🛡️ <strong>Vous n'avez rien demandé ?</strong> Ignorez simplement cet email :
            votre mot de passe actuel reste inchangé et personne ne peut y accéder.
            Despy ne vous demandera <strong>jamais</strong> votre mot de passe par
            téléphone, SMS ou email.
          </p>
        </div>
        <p style="font-size:11px;color:#aaa;text-align:center">
          Despy · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a> · Cet email a été envoyé suite à une demande sur la page de connexion.
        </p>
      </div>
    </div>
  `;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  // Réponse neutre unique, renvoyée dans tous les cas
  const neutral = { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  if (!rateLimit(event, 'pwreset', 5, 15 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de demandes. Réessayez dans 15 minutes.' }) };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    const norm = String(email || '').toLowerCase().trim();
    if (!norm || !norm.includes('@') || norm.length > 254) return neutral;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: client } = await supabase
      .from('clients')
      .select('email, prenom, name')
      .eq('email', norm)
      .maybeSingle();

    if (!client) return neutral; // on ne révèle rien

    const token = issueResetToken(norm);
    const link = `https://despy.fr/?reset=${encodeURIComponent(token)}`;
    const prenom = client.prenom || (client.name || '').split(' ')[0] || 'cher membre';

    await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({
        type: 'custom',
        data: {
          email: norm,
          subject: '🔑 Despy — Réinitialiser votre mot de passe (lien valable 30 min)',
          html: buildResetEmailHTML(prenom, link)
        }
      })
    });

    return neutral;
  } catch (e) {
    console.error('request-password-reset:', e.message);
    return neutral; // même en cas d'erreur, réponse neutre
  }
};
