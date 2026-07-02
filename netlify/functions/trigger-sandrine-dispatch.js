// ════════════════════════════════════════════
// DESPY — TEMPORAIRE : déclenche le dispatch Privacy Cleanup pour la
// cliente qui a activé AVANT la mise en place de l'automate.
// Données verrouillées en dur. À SUPPRIMER après usage.
// ════════════════════════════════════════════

const KEY = '32c4371a0aae80198f085944';

exports.handler = async (event) => {
  const k = (event.queryStringParameters || {}).k;
  if (k !== KEY) return { statusCode: 404, body: 'Not found' };

  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/privacy-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({
        user_email: 'sandrinebouazzaoui000@gmail.com',
        prenom: 'Sandrine',
        nom: 'Bouazzaoui Hoerth',
        target_email: 'sandrinebouazzaoui000@gmail.com',
        phone: '06 19 40 34 85',
        ville: 'Strasbourg',
        activated_at: '2026-07-01T00:00:00.000Z'
      })
    });
    const body = await r.text();
    return { statusCode: 200, body: JSON.stringify({ ok: r.ok, status: r.status, result: body.slice(0, 300) }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
