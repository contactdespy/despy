// ════════════════════════════════════════════
// DESPY — Signature des liens de validation Privacy Cleanup.
// Partagé entre privacy-scan-background.js (génère les liens des boutons
// « Afficher / Ignorer » de l'email) et privacy-validate.js (vérifie).
// ════════════════════════════════════════════

const crypto = require('crypto');
const SECRET = process.env.INTERNAL_SECRET || process.env.AUTH_TOKEN_SECRET || 'despy';

// Signature courte liée au trio (email, id de la trouvaille, action).
// Empêche qu'on valide/masque une trouvaille sans passer par l'email.
function signFinding(email, id, action) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${String(email || '').toLowerCase()}|${id}|${action}`)
    .digest('hex')
    .slice(0, 24);
}

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé, pas un endpoint
module.exports = { signFinding, handler };
