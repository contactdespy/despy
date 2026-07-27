// ════════════════════════════════════════════
// DESPY — Détecte un déclenchement PLANIFIÉ (cron Netlify) vs un appel HTTP.
//
// Les fonctions planifiées (clé `schedule` dans netlify.toml) sont invoquées
// par Netlify avec un corps JSON contenant { next_run } (horodatage de la
// prochaine exécution). Un appel HTTP direct (navigateur, curl) n'a pas ce
// corps. On s'en sert pour empêcher qu'un cron soit déclenché par quiconque
// connaît son URL (envois en masse indésirables / coût API).
//
// Sur les fonctions à double mode (hibp-check, hudsonrock-check…), le garde-fou
// se place APRÈS le bloc manuel authentifié et ne protège que la boucle cron.
// ════════════════════════════════════════════

function isScheduled(event) {
  try { return !!JSON.parse((event && event.body) || '{}').next_run; }
  catch (e) { return false; }
}

// Réponse standard quand un cron reçoit un appel non planifié : ne rien faire.
function notScheduled() {
  return { statusCode: 200, body: JSON.stringify({ skipped: 'not_scheduled' }) };
}

module.exports = { isScheduled, notScheduled };
