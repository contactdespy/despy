// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : reprise mensuelle (le déclencheur)
// Cron : 1er du mois 5h UTC → 0 5 1 * * (voir netlify.toml)
//
// Ne fait qu'une chose : lancer privacy-recheck-background.js, où se trouve
// tout le travail. Une fonction planifiée est coupée au bout de 30 secondes ;
// la fonction d'arrière-plan en a 900.
// ════════════════════════════════════════════

const { isScheduled, notScheduled } = require('./_is-scheduled');
const { alerterAdmin } = require('./_db');

exports.handler = async (event) => {
  if (!isScheduled(event)) return notScheduled();

  const secret = process.env.INTERNAL_SECRET || '';
  let statut = 0, raison = '';
  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/privacy-recheck-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: '{}'
    });
    statut = r.status;
  } catch (e) { raison = e.message; }

  // Une fonction d'arrière-plan répond 202 dès qu'elle est acceptée. Tout
  // autre code veut dire que le passage du mois n'a pas démarré — et un cron
  // de 5 h du matin n'a aucun témoin : on le dit par email.
  if (statut !== 202 && statut !== 200) {
    console.error(`privacy-recheck: passage non lancé (HTTP ${statut || '—'} ${raison})`);
    await alerterAdmin(
      'privacy-recheck — passage mensuel non lancé',
      `La fonction d'arrière-plan n'a pas démarré (HTTP ${statut || 'aucune réponse'}${raison ? ' — ' + raison : ''}). `
      + 'Aucune lettre ni recherche ce mois-ci tant que ce n\'est pas relancé.',
      {}
    );
  }
  return { statusCode: 200, body: JSON.stringify({ lance: statut === 202 || statut === 200, statut }) };
};
