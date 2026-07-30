// ════════════════════════════════════════════
// DESPY — Signature des liens « Publier / Rejeter » du module du mois.
// Partagé entre monthly-training.js (génère les boutons de l'email) et
// training-validate.js (vérifie). Empêche de publier un module de formation
// sans passer par l'email de validation.
// ════════════════════════════════════════════

const crypto = require('crypto');
const SECRET = process.env.INTERNAL_SECRET || process.env.AUTH_TOKEN_SECRET || 'despy';

function signModule(id, action) {
  return crypto.createHmac('sha256', SECRET)
    .update(`module|${id}|${action}`)
    .digest('hex')
    .slice(0, 24);
}

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé
module.exports = { signModule, handler };
