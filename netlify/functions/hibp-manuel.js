// ════════════════════════════════════════════
// DESPY — Vérification des fuites à la demande (membre connecté)
// Netlify Function : /.netlify/functions/hibp-manuel
//
// C'est le bouton « Vérifier mon email » de l'appli, étape 1 du parcours
// Protection. Il pointait avant sur hibp-check.js — une fonction PLANIFIÉE,
// que Netlify bloque au bord par un 403 vide. Le membre voyait « Erreur
// réseau » à chaque essai, et rien n'apparaissait dans les logs puisque notre
// code n'était jamais atteint. D'où cette fonction séparée, sans `schedule`.
//
// Différence avec hibp-public.js : celle-là est l'outil d'acquisition (un
// nombre, sans détail, pour donner envie de s'inscrire). Ici le membre est
// authentifié, donc on va au bout : on nomme les fuites, on historise le
// résultat sur sa fiche, on lui envoie le détail par email et on prévient sa
// personne de confiance.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth, rateLimit } = require('./_auth');
const { verifierEtHistoriser } = require('./_hibp');

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'method' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}

  // L'adresse vérifiée est celle du JETON, jamais celle envoyée par le
  // navigateur. Un champ libre aurait permis de faire partir le détail d'une
  // fuite vers l'adresse de n'importe qui, et d'écrire l'historique sur la
  // fiche d'un autre membre. Pour vérifier une autre adresse, il y a la page
  // publique /verifier-email-pirate, anonyme et sans email envoyé.
  const auth = requireAuth(event, body, body.email, HEADERS);
  if (!auth.ok) return auth.response;
  const email = auth.email;

  // Chaque vérification appelle HIBP et peut déclencher deux emails : on borne
  // à 5 par IP et par quart d'heure. Un membre en fait une, pas trente.
  if (!rateLimit(event, 'hibp-manuel', 5, 15 * 60 * 1000)) {
    return {
      statusCode: 429, headers: HEADERS,
      body: JSON.stringify({ error: 'rate_limit', breachCount: null })
    };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const res = await verifierEtHistoriser(supabase, email);

  // Statut 200 même en cas d'indisponibilité de HIBP : ce n'est pas une erreur
  // de la requête, et l'appli sait dire « momentanément indisponible » à partir
  // du champ `error`. Un 4xx/5xx ici ferait croire à une session expirée et
  // déconnecterait le membre (l'appli surveille les 401).
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(res) };
};
