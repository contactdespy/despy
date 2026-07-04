// ════════════════════════════════════════════
// DESPY — Vérification publique HIBP
// Netlify Function : /.netlify/functions/hibp-public
// Page d'acquisition : "Mon email est-il compromis ?"
// Retourne le nombre de fuites sans détail → incite à s'inscrire
// ════════════════════════════════════════════

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    if (!process.env.HIBP_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Service indisponible' }) };
    }

    const res = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`,
      {
        headers: {
          'hibp-api-key': process.env.HIBP_API_KEY,
          'user-agent': 'Despy-Protection (contact@despy.fr)',
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (res.status === 404) {
      // Aucune fuite — email sûr
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ count: 0, safe: true })
      };
    }

    if (res.status === 429) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de requêtes, réessayez dans quelques secondes' }) };
    }

    if (!res.ok) {
      // Service HIBP indisponible (clé expirée, quota, panne…). On log le vrai
      // statut côté serveur et on répond « unavailable » : l'UI masque l'outil
      // proprement au lieu d'afficher une erreur au prospect.
      console.error('HIBP upstream status:', res.status, (await res.text()).slice(0, 200));
      return { statusCode: 200, headers, body: JSON.stringify({ unavailable: true, upstream: res.status }) };
    }

    const breaches = await res.json();
    const count    = breaches.length;

    // On retourne uniquement le nombre + les noms des fuites (pas les détails)
    // Les détails complets sont réservés aux abonnés via hibp-check.js
    const names = breaches.slice(0, 3).map(b => b.Name);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count,
        safe: false,
        preview: names, // max 3 noms pour créer l'urgence
        message: count === 1
          ? `Votre email a été trouvé dans 1 fuite de données.`
          : `Votre email a été trouvé dans ${count} fuites de données.`
      })
    };

  } catch (err) {
    console.error('HIBP public error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
