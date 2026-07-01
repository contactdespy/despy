// ════════════════════════════════════════════
// DESPY — Mot de passe oublié (étape 2 : changement)
// POST { token, password }
//
// Vérifie le jeton « pwreset » (30 min, signé HMAC) puis enregistre le
// nouveau mot de passe, haché exactement comme à l'inscription
// (scrypt + sel — voir register-free.js).
// ════════════════════════════════════════════

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { rateLimit } = require('./_auth');

const SECRET = process.env.AUTH_TOKEN_SECRET || process.env.INTERNAL_SECRET || '';

function fromB64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Renvoie l'email si le jeton de réinitialisation est valide, sinon null
function verifyResetToken(token) {
  if (!token || !SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  let payload;
  try { payload = fromB64url(token.slice(0, dot)); } catch (e) { return null; }
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [purpose, email, exp] = payload.split('|');
  if (purpose !== 'pwreset' || !email || !exp || Date.now() > Number(exp)) return null;
  return email;
}

// Hachage identique à register-free.js
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  if (!rateLimit(event, 'pwreset-do', 8, 15 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' }) };
  }

  try {
    const { token, password } = JSON.parse(event.body || '{}');

    const email = verifyResetToken(String(token || ''));
    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Lien invalide ou expiré. Refaites une demande depuis la page de connexion.', code: 'BAD_TOKEN' }) };
    }
    if (typeof password !== 'string' || password.length < 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Le mot de passe doit contenir au moins 8 caractères.', code: 'WEAK_PASSWORD' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: client } = await supabase
      .from('clients')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (!client) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Compte introuvable.', code: 'NO_ACCOUNT' }) };
    }

    const { error } = await supabase
      .from('clients')
      .update({ password_hash: hashPassword(password), updated_at: new Date().toISOString() })
      .eq('email', email);
    if (error) {
      console.error('reset-password update:', error.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur. Réessayez.' }) };
    }

    console.log(`Mot de passe réinitialisé pour ${email}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('reset-password:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur. Réessayez.' }) };
  }
};
