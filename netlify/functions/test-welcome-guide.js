// ════════════════════════════════════════════
// DESPY — TEMPORAIRE : envoi de test du guide de démarrage au fondateur.
// Destinataire verrouillé en dur. À SUPPRIMER après le test.
// ════════════════════════════════════════════

const KEY = '84c173fa15e64cb9478c760e';
const OWNER = 'yacine.bourefis67@gmail.com';

exports.handler = async (event) => {
  const k = (event.queryStringParameters || {}).k;
  if (k !== KEY) return { statusCode: 404, body: 'Not found' };

  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({
        type: 'welcome_guide',
        data: { email: OWNER, name: 'Yacine', prenom: 'Yacine', referralCode: 'DESPY-TEST' }
      })
    });
    const body = await r.text();
    return { statusCode: 200, body: JSON.stringify({ sent: r.ok, status: r.status, body: body.slice(0, 200) }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
