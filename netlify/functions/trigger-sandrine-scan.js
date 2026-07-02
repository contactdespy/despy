// ════════════════════════════════════════════
// DESPY — TEMPORAIRE : déclenche le scan d'empreinte pour la cliente
// activée avant l'agent. À SUPPRIMER après usage.
// ════════════════════════════════════════════

const KEY = '4a808cf015b02d0a0fedef72';

exports.handler = async (event) => {
  const k = (event.queryStringParameters || {}).k;
  if (k !== KEY) return { statusCode: 404, body: 'Not found' };

  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/privacy-scan-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({
        user_email: 'sandrinebouazzaoui000@gmail.com',
        prenom: 'Sandrine',
        nom: 'Bouazzaoui Hoerth',
        target_email: 'sandrinebouazzaoui000@gmail.com',
        phone: '06 19 40 34 85',
        ville: 'Strasbourg'
      })
    });
    // La fonction background renvoie 202 immédiatement ; le rapport arrive par email.
    return { statusCode: 200, body: JSON.stringify({ triggered: true, status: r.status, note: 'Scan lancé — rapport par email sous ~1 min' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
