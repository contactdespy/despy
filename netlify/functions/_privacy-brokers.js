// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : la liste des brokers/annuaires traités.
// Ajouter un broker = ajouter une ligne ici, rien d'autre à toucher.
//
// EMAIL_BROKERS : demande RGPD art. 17 envoyée AUTOMATIQUEMENT par
//   privacy-dispatch.js. N'ajouter que des adresses vérifiées
//   (source officielle ou constatée) — une demande légale envoyée
//   à une mauvaise adresse est une demande dans le vide.
// FORM_BROKERS : pas d'adresse email fiable → traitement via leur
//   formulaire (listé dans le récap envoyé à l'équipe, ~5 min).
// ════════════════════════════════════════════

const EMAIL_BROKERS = [
  {
    id: 'solocal',
    name: 'PagesJaunes / PagesBlanches (Solocal)',
    email: 'dpo@solocal.com',
    // Exigence Solocal : préciser la plateforme concernée dans la demande
    platformNote: 'Plateforme concernée : pagesjaunes.fr (et pagesblanches)'
  },
  {
    id: '118218',
    name: '118218 — Le Numéro',
    email: 'service-client@118218.fr',
    platformNote: 'Annuaire 118218.fr'
  },
  {
    id: '118000',
    name: '118000.fr',
    email: 'contact@118000.fr',
    platformNote: 'Annuaire 118000.fr'
  }
];

const FORM_BROKERS = [
  {
    id: '118712',
    name: '118712 (Orange)',
    url: 'https://www.118712.fr/faq/supprimer-donnees-annuaire',
    note: 'Formulaire de suppression en ligne'
  },
  {
    id: 'google-ryc',
    name: 'Google — « Résultats vous concernant »',
    url: 'https://myactivity.google.com/results-about-you',
    note: 'Déréférence les résultats contenant téléphone/adresse (très efficace)'
  },
  {
    id: 'infobel',
    name: 'Infobel',
    url: 'https://www.infobel.com/fr/france',
    note: 'Chercher la fiche puis « signaler / supprimer »'
  },
  {
    id: 'annuaire-com',
    name: 'annuaire.com',
    url: 'https://www.annuaire.com',
    note: 'Vérifier si une fiche existe, formulaire de contact sinon'
  }
];

module.exports = { EMAIL_BROKERS, FORM_BROKERS };
