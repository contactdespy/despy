// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : où en est chaque demande (module partagé)
//
// Jusqu'ici, rien ne faisait jamais passer une demande à « supprimé ».
// L'état `confirmed` existait dans le schéma, « quand le broker répond » —
// mais personne ne lisait ces réponses, donc l'espace client affichait
// « en cours » pour toujours, et la relance promise à 30 jours ne partait
// jamais non plus.
//
// La seule personne qui sait si elle figure encore dans un annuaire, c'est le
// client. Un mois après la lettre, on le lui demande (privacy-suivi.js), et
// c'est sa réponse qui fait avancer la demande (privacy-suivi-reponse.js).
//
// Les états d'une ligne de privacy_dispatch_log, dans l'ordre :
//
//   sent ──(1 mois)──▶ asked ──▶ confirmed            « c'est retiré »
//                            └─▶ [nouvelle ligne] reminded   la relance est partie
//   reminded ──(1 mois)──▶ asked_again ──▶ confirmed
//                                      └─▶ cnil        deux lettres sans effet
//
// Une relance est une NOUVELLE ligne, pas une modification : la date de la
// première lettre reste intacte (c'est une pièce, si la CNIL est saisie), et
// privacy-dispatch voit qu'une lettre récente existe pour cet annuaire.
//
// Pas de troisième lettre : après une relance sans effet, écrire encore ne
// sert plus à rien. La suite est une plainte, et elle est au nom du client.
// ════════════════════════════════════════════

const { EMAIL_BROKERS } = require('./_privacy-brokers');
const { signFinding } = require('./_privacy-sign');

// Le délai légal de réponse est d'un mois (RGPD, art. 12.3). 31 jours : on ne
// demande pas « y êtes-vous encore ? » la veille de l'échéance.
const DELAI_JOURS = 31;

const annuaire = (id) => EMAIL_BROKERS.find((b) => b.id === id) || null;

// Pour chaque annuaire, la ligne la plus récente — la seule qui compte.
// Quand une lettre est renvoyée (adresse corrigée, relance), l'ancienne ligne
// reste dans le journal : sans ce tri, l'espace client afficherait deux fois
// le même annuaire, et le suivi interrogerait le client sur une lettre
// remplacée depuis.
function dernieres(lignes) {
  const par = new Map();
  for (const l of lignes || []) {
    const vue = par.get(l.broker_id);
    if (!vue || new Date(l.sent_at) > new Date(vue.sent_at)) par.set(l.broker_id, l);
  }
  return par;
}

// Faut-il poser la question au client pour cette ligne ?
// 0 = non · 1 = après la première lettre · 2 = après la relance
function etapeDue(ligne, maintenant) {
  const b = annuaire(ligne.broker_id);
  if (!b || !b.verif || !b.verif.length) return 0;       // rien à vérifier en ligne
  if (b.depuis && new Date(ligne.sent_at) < new Date(b.depuis)) return 0;   // lettre partie à l'ancienne adresse
  const age = (maintenant.getTime() - new Date(ligne.sent_at).getTime()) / 86400000;
  if (age < DELAI_JOURS) return 0;
  if (ligne.status === 'sent') return 1;
  if (ligne.status === 'reminded') return 2;
  return 0;                                              // déjà demandé, ou réglé
}

// Ce que l'espace client affiche pour une ligne.
function affichage(ligne) {
  switch (ligne.status) {
    case 'confirmed':
      return { status: 'supprime', kind: 'Vous nous avez confirmé le retrait' };
    case 'asked':
      return { status: 'action', kind: 'Un mois a passé',
               hint: 'Y figurez-vous encore ? Répondez depuis l\'email que nous vous avons envoyé : un clic suffit pour relancer.' };
    case 'reminded':
      return { status: 'encours', kind: 'Relance envoyée' };
    case 'asked_again':
      return { status: 'action', kind: 'Un mois a passé depuis la relance',
               hint: 'Y figurez-vous encore ? Répondez depuis l\'email que nous vous avons envoyé.' };
    case 'cnil':
      return { status: 'action', kind: 'Deux demandes sans effet',
               hint: 'Vous pouvez saisir la CNIL : nous vous avons envoyé la marche à suivre, avec les dates de vos deux demandes.' };
    default:
      return { status: 'encours', kind: 'Demande de suppression envoyée' };
  }
}

// Lien signé vers la page de réponse. L'identifiant de la ligne ET l'adresse
// du client sont dans la signature : on ne répond pas pour quelqu'un d'autre
// en changeant un chiffre dans l'URL.
function lienReponse(base, email, ligneId, reponse) {
  const e = String(email || '').toLowerCase().trim();
  return `${base}/.netlify/functions/privacy-suivi-reponse?e=${encodeURIComponent(e)}&l=${ligneId}`
       + `&r=${reponse}&k=${signFinding(e, ligneId, 'suivi')}`;
}

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé, pas un endpoint
module.exports = { DELAI_JOURS, annuaire, dernieres, etapeDue, affichage, lienReponse, handler };
