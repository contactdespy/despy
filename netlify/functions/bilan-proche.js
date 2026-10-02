// ════════════════════════════════════════════
// DESPY — Le bilan du proche (le déclencheur)
// Cron : 1er du mois à 6 h UTC → 0 6 1 * * (voir netlify.toml)
//
// Ne fait qu'une chose : lancer bilan-proche-background.js, où se trouve le
// travail. Une fonction planifiée est coupée au bout de 30 secondes.
//
// Tôt le 1er, et pas plus tard : le compteur de questions d'un client ne
// garde qu'un mois, et bascule dès sa première question du mois suivant.
// ════════════════════════════════════════════

const { isScheduled, notScheduled } = require('./_is-scheduled');
const { alerterAdmin } = require('./_db');

exports.handler = async (event) => {
  if (!isScheduled(event)) return notScheduled();

  let statut = 0, raison = '';
  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/bilan-proche-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: '{}'
    });
    statut = r.status;
  } catch (e) { raison = e.message; }

  if (statut !== 202 && statut !== 200) {
    console.error(`bilan-proche: envoi non lancé (HTTP ${statut || '—'} ${raison})`);
    await alerterAdmin(
      'bilan-proche — envoi mensuel non lancé',
      `La fonction d'arrière-plan n'a pas démarré (HTTP ${statut || 'aucune réponse'}${raison ? ' — ' + raison : ''}). `
      + 'Aucun proche n\'a reçu son bilan ce mois-ci.',
      {}
    );
  }
  return { statusCode: 200, body: JSON.stringify({ lance: statut === 202 || statut === 200, statut }) };
};
