// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : à qui on écrit, et ce que seul le client peut faire.
// Ajouter un annuaire = ajouter une ligne ici, rien d'autre à toucher.
//
// Il n'y a plus de troisième catégorie « formulaire à remplir par l'équipe ».
// Elle existait, et elle reposait sur un email interne que personne n'a
// jamais reçu : pendant des mois, quatre destinataires sur sept n'ont été
// contactés pour aucun client, alors que la page de vente les citait.
// Désormais, soit Despy peut écrire (EMAIL_BROKERS), soit seul le client le
// peut et on lui donne le chemin (GUIDES_CLIENT). Rien ne dépend d'une
// tâche manuelle que quelqu'un pourrait ne pas voir.
//
// EMAIL_BROKERS : demande RGPD art. 17 envoyée AUTOMATIQUEMENT par
//   privacy-dispatch.js. Une demande légale envoyée à une mauvaise adresse
//   est une demande dans le vide : chaque adresse porte la page OFFICIELLE où
//   elle a été lue (`source`) et la date de la lecture (`verifie`).
//
//   `depuis` : date à partir de laquelle l'adresse ou le contenu de la lettre
//   est celui-ci. Une lettre partie AVANT cette date est partie ailleurs, ou
//   sans nommer la bonne plateforme : privacy-dispatch la renvoie une fois.
//   Corriger une adresse = changer `email` ET mettre `depuis` au jour même.
//
//   `verif` : où le client peut chercher son nom lui-même. C'est ce qui permet
//   de lui demander, un mois après la lettre, s'il y figure encore
//   (privacy-suivi.js). Un annuaire sans recherche en ligne ne peut pas être
//   suivi de cette façon — et n'a sans doute rien à faire dans cette liste.
//
//   Avant d'ajouter un annuaire, vérifier DEUX choses sur son site, pas une :
//   l'adresse où écrire, et qu'il publie bien des PARTICULIERS. 118218.fr
//   avait la bonne adresse (dpo@118218.fr) et se décrit lui-même comme un
//   service de renseignements sur « les abonnés professionnels » : la lettre
//   partait pour rien, et la page de vente le citait à tort.
//
// GUIDES_CLIENT : démarches que l'annuaire n'accepte que de la personne
//   elle-même. Elles partent dans le récap envoyé au client.
// ════════════════════════════════════════════

const EMAIL_BROKERS = [
  {
    id: 'solocal',
    name: 'PagesJaunes · PagesBlanches · 118 712',
    email: 'dpo@solocal.com',
    // 118712.fr n'a pas de contact propre : sa page vie privée renvoie au
    // délégué de Solocal, dont il diffuse l'annuaire. Une seule lettre, donc,
    // mais qui doit nommer les trois plateformes — Solocal l'exige.
    platformNote: "Plateformes concernées : pagesjaunes.fr, pagesblanches.fr et l'annuaire diffusé sur 118712.fr",
    source: 'https://www.118712.fr/politique-cookies',
    verifie: '2026-10-02',
    depuis: '2026-10-02T11:45:00Z',     // la lettre ne nommait pas 118712.fr avant
    verif: [
      { nom: 'PagesBlanches', url: 'https://www.pagesjaunes.fr/pagesblanches' },
      { nom: '118 712 (onglet « Particuliers »)', url: 'https://www.118712.fr/' }
    ]
  },
  {
    id: '118000',
    name: '118 000',
    email: 'privacy@groupe-pratique.com',
    platformNote: 'Annuaire 118000.fr (Pratique Media & Services)',
    source: 'https://www.118000.fr/cgu.html',           // « Ces droits s'exercent… »
    verifie: '2026-10-02',
    depuis: '2026-10-02T11:45:00Z',     // partait à contact@118000.fr
    verif: [
      { nom: '118 000 (annuaire des particuliers)', url: 'https://annuaire.118000.fr/' }
    ]
  }
];

// annuaire.com n'est plus ici : le domaine redirige vers un annuaire
// d'ENTREPRISES (Hoodspot, Société SAS). Il ne publie plus de particuliers.
const GUIDES_CLIENT = [
  {
    id: 'google',
    name: 'Google — « Résultats vous concernant »',
    url: 'https://myactivity.google.com/results-about-you',
    pourquoi: "Google ne l'accepte que depuis votre propre compte Google.",
    comment: "Connectez-vous, indiquez votre nom, votre téléphone et votre adresse : Google vous prévient quand ils apparaissent dans ses résultats, et vous demandez leur retrait en un clic."
  },
  {
    id: 'infobel',
    name: 'Infobel',
    url: 'https://dpo.infobel.com',
    pourquoi: "Infobel exige la copie d'une pièce d'identité, que vous seul pouvez fournir.",
    comment: "Remplissez leur formulaire en demandant l'effacement de vos données, et joignez la copie de votre pièce d'identité."
  }
];

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé, pas un endpoint
module.exports = { EMAIL_BROKERS, GUIDES_CLIENT, handler };
