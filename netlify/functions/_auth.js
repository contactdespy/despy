// ════════════════════════════════════════════
// DESPY — Auth partagée (jeton signé HMAC)
// Jeton délivré à la connexion, vérifié par les
// fonctions qui manipulent les données d'un client.
// Format : base64url(email|exp).signatureHMAC
// ════════════════════════════════════════════
const crypto = require('crypto');

const SECRET = process.env.AUTH_TOKEN_SECRET || process.env.INTERNAL_SECRET || '';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Délivre un jeton pour cet email (à la connexion / inscription)
function issueToken(email) {
  const payload = `${String(email).toLowerCase().trim()}|${Date.now() + TOKEN_TTL_MS}`;
  return `${b64url(payload)}.${sign(payload)}`;
}

// Vérifie un jeton, renvoie l'email s'il est valide, sinon null
function verifyToken(token) {
  if (!token || !SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = fromB64url(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [email, exp] = payload.split('|');
  if (!email || !exp || Date.now() > Number(exp)) return null;
  return email;
}

// Extrait le jeton de la requête (header Authorization: Bearer xxx, ou body.authToken)
function tokenFromEvent(event, body) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (body && body.authToken) return String(body.authToken);
  if (event.queryStringParameters && event.queryStringParameters.authToken) {
    return String(event.queryStringParameters.authToken);
  }
  return null;
}

// Auth stricte : le jeton doit être valide ET correspondre à l'email réclamé.
// Renvoie { ok:true } ou { ok:false, response } (réponse 401 prête à retourner).
function requireAuth(event, body, claimedEmail, headers) {
  const tokenEmail = verifyToken(tokenFromEvent(event, body));
  const claimed = String(claimedEmail || '').toLowerCase().trim();
  if (tokenEmail && claimed && tokenEmail === claimed) return { ok: true, email: tokenEmail };
  return {
    ok: false,
    response: {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Session expirée. Merci de vous reconnecter.', code: 'AUTH_REQUIRED' })
    }
  };
}

// Auth souple : si un email est fourni AVEC un jeton, ils doivent correspondre.
// Sans jeton, on laisse passer (parcours anonymes / paiement) mais on le signale.
function softAuth(event, body, claimedEmail) {
  const token = tokenFromEvent(event, body);
  if (!token) return { ok: true, verified: false };
  const tokenEmail = verifyToken(token);
  const claimed = String(claimedEmail || '').toLowerCase().trim();
  if (tokenEmail && (!claimed || tokenEmail === claimed)) return { ok: true, verified: true, email: tokenEmail };
  return { ok: false, verified: false };
}

// ── Limite de tentatives en mémoire (par IP) ──
// Protège les endpoints sensibles contre les rafales tant que l'instance est chaude.
const _buckets = new Map();
function rateLimit(event, key, max, windowMs) {
  const ip = (event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '')).split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const id = `${key}:${ip}`;
  let b = _buckets.get(id);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; _buckets.set(id, b); }
  b.count++;
  if (_buckets.size > 5000) _buckets.clear();
  return b.count <= max;
}

// Module partage, pas un endpoint : acces direct -> 404 propre (au lieu du 502 Netlify).
const handler = async () => ({ statusCode: 404, body: 'Not found' });
module.exports = { issueToken, verifyToken, requireAuth, softAuth, rateLimit, tokenFromEvent, handler };
