// ════════════════════════════════════════════
// DESPY — Alerte Secteur : abonnement aux alertes de sa zone
// POST auth { user_email, code_postal, ville }
//
// Gratuit  → récap hebdomadaire des signalements de SA commune (fraud-digest)
// Premium  → en plus : notification immédiate (push + email) sur tout
//            le DÉPARTEMENT (_fraud-alerts.js)
// DELETE-like : POST { unsubscribe: true } pour se désinscrire.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth, rateLimit } = require('./_auth');

async function geocodeCheck(codePostal, ville) {
  const res = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(codePostal)}&fields=nom&format=json`, {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const communes = await res.json();
  if (!communes || communes.length === 0) return null;
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const match = communes.find(c => norm(c.nom) === norm(ville)) || communes[0];
  return match.nom;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  if (!rateLimit(event, 'fraudsub', 10, 60 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de demandes, réessayez plus tard.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const auth = requireAuth(event, body, body.user_email, headers);
  if (!auth.ok) return auth.response;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Désinscription
    if (body.unsubscribe) {
      await supabase.from('fraud_alert_subs').delete().eq('email', auth.email);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, subscribed: false }) };
    }

    const codePostal = String(body.code_postal || '').replace(/\D/g, '');
    const ville = String(body.ville || '').trim().slice(0, 80);
    if (codePostal.length !== 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code postal invalide.' }) };
    }

    const communeNom = await geocodeCheck(codePostal, ville);
    if (!communeNom) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Commune introuvable pour ce code postal.' }) };
    }

    const { error } = await supabase.from('fraud_alert_subs').upsert({
      email: auth.email,
      ville: communeNom,
      code_postal: codePostal,
      created_at: new Date().toISOString()
    }, { onConflict: 'email' });
    if (error) throw new Error(error.message);

    // Le niveau (différé commune / temps réel département) dépend du statut
    // premium — on le lit pour renvoyer le bon message à l'UI.
    let premium = false;
    try {
      const { data: cli } = await supabase.from('clients').select('subscribed').eq('email', auth.email).maybeSingle();
      premium = !!(cli && cli.subscribed);
    } catch (e) {}

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true, subscribed: true, premium, ville: communeNom,
        message: premium
          ? `Alertes temps réel activées : vous serez prévenu immédiatement (notification + email) pour tout le département.`
          : `Alertes activées : vous recevrez chaque semaine le récapitulatif des signalements à ${communeNom}. Passez Premium pour le temps réel sur tout le département.`
      })
    };
  } catch (e) {
    console.error('fraud-subscribe:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur, réessayez.' }) };
  }
};
