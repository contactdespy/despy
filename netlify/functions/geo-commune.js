// ════════════════════════════════════════════
// DESPY — Position du téléphone → commune (rien de plus)
// POST { lat, lon } → { ville, code_postal }
//
// VIE PRIVÉE — le point important :
//   Les coordonnées servent UNIQUEMENT à retrouver le nom de la commune,
//   le temps de la requête. Elles ne sont ni stockées, ni journalisées, ni
//   transmises à qui que ce soit d'autre. Seule la commune revient à l'appli,
//   et c'est la commune (jamais la position) qui sera éventuellement
//   enregistrée avec un signalement.
//
// Passe par le serveur plutôt que par le navigateur pour deux raisons :
// garder la CSP fermée, et pouvoir garantir ce qui précède.
// Source : geo.api.gouv.fr — API officielle, gratuite, sans clé.
// ════════════════════════════════════════════

const { rateLimit } = require('./_auth');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!rateLimit(event, 'geo', 30, 10 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de demandes, réessayez dans quelques minutes.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const lat = parseFloat(body.lat), lon = parseFloat(body.lon);

  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Position invalide' }) };
  }

  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codesPostaux&format=json`,
      { headers: { 'User-Agent': 'Despy/1.0 (contact@despy.fr)' }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) throw new Error('geo.api.gouv.fr ' + r.status);
    const communes = await r.json();

    if (!Array.isArray(communes) || !communes.length) {
      // Hors de France, ou position trop imprécise : on le dit franchement
      // plutôt que de deviner une commune au hasard.
      return { statusCode: 200, headers, body: JSON.stringify({ trouve: false }) };
    }

    const c = communes[0];
    const cp = (c.codesPostaux && c.codesPostaux[0]) || '';
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ trouve: true, ville: c.nom, code_postal: cp })
    };
  } catch (err) {
    // On ne journalise jamais lat/lon — seulement la nature de l'erreur.
    console.error('geo-commune:', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ trouve: false, error: 'indisponible' }) };
  }
};
