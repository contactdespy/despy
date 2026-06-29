// ════════════════════════════════════════════
// DESPY — « Votre appareil a-t-il été infecté ? »
// Détection d'infostealer (virus voleur de mots de passe)
// Source : Hudson Rock — Cavalier, endpoint OSINT GRATUIT (sans clé API)
//
// Complète HIBP : HIBP dit "tel SITE a fuité votre email",
// Hudson Rock dit "tel APPAREIL lié à votre email a été infecté"
// (= bien plus grave : tous les mots de passe de l'appareil sont volés).
//
// IMPORTANT (vie privée) : on ne renvoie JAMAIS au navigateur les
// mots de passe / identifiants / IP / nom de machine exposés par l'API.
// On ne garde que des métadonnées sûres : date d'infection + système.
// ════════════════════════════════════════════

const HR_BASE = 'https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email';

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

    const res = await fetch(
      `${HR_BASE}?email=${encodeURIComponent(email.toLowerCase().trim())}`,
      {
        headers: { 'User-Agent': 'Despy-Protection (contact@despy.fr)' },
        signal: AbortSignal.timeout(12000)
      }
    );

    // En cas de souci côté Hudson Rock, on ne fait pas peur :
    // infected:null → le navigateur masque simplement le bloc.
    if (!res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ infected: null, error: 'unavailable' }) };
    }

    const data = await res.json();
    const stealers = Array.isArray(data.stealers) ? data.stealers : [];
    const count = stealers.length;

    if (count === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ infected: false, count: 0 }) };
    }

    // Métadonnées sûres uniquement (max 3 appareils).
    const computers = stealers.slice(0, 3).map(s => ({
      date: (s.date_compromised || '').slice(0, 10),
      os: (s.operating_system && s.operating_system !== 'Not Found') ? s.operating_system : null
    }));

    // Nombre total de comptes/identifiants exposés sur les appareils infectés.
    const services = stealers.reduce((sum, s) => sum + (Number(s.total_user_services) || 0), 0);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ infected: true, count, computers, services })
    };

  } catch (err) {
    console.error('Hudson Rock public error:', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ infected: null, error: 'server' }) };
  }
};
