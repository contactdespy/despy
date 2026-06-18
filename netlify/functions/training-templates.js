// ════════════════════════════════════════════
// DESPY — Bibliothèque des messages-test d'entraînement anti-arnaque
// USAGE STRICTEMENT INTERNE & OPT-IN (sensibilisation type "phishing
// simulation" d'entreprise, adapté à la famille).
// Règles de sécurité NON négociables :
//   - Le lien {{LINK}} pointe TOUJOURS vers la page de coaching Despy
//     (/entrainement) — jamais vers un site tiers.
//   - Aucune donnée n'est collectée, aucun vrai risque.
//   - N'envoyer qu'à des personnes ayant activé l'entraînement.
// Chaque modèle fournit aussi le "débrief" (indices + bon réflexe) affiché
// sur la page de coaching si la personne clique.
// ════════════════════════════════════════════

// Réalistes volontairement (sinon l'entraînement n'apprend rien), mais inoffensifs.
const TEMPLATES = [
  {
    id: 'colis_laposte',
    channel: 'email',
    brand: 'La Poste',
    from: 'La Poste – Suivi <suivi@laposte-colis-fr.com>',
    subject: 'Votre colis n°LP-883204 est en attente de livraison',
    body: `Bonjour,<br><br>Votre colis n'a pas pu être livré faute d'affranchissement complet. Des frais de réexpédition de <b>1,99 €</b> restent à régler sous 48h, sans quoi le colis sera retourné à l'expéditeur.<br><br>Numéro de suivi : <b>LP-883204-FR</b><br><br>{{BUTTON:Régler et programmer la livraison}}<br><br>Merci de votre confiance,<br>Service Clients La Poste`,
    title: 'Faux message de colis (frais à payer)',
    redFlags: [
      "Un petit montant à payer (1,99 €) pour « débloquer » un colis : La Poste ne fonctionne jamais ainsi.",
      "L'adresse de l'expéditeur n'est pas un vrai domaine officiel (laposte-colis-fr.com).",
      "L'urgence : « sous 48h sinon retour » pour vous faire agir vite."
    ],
    reflex: "Ne cliquez pas. Suivez votre colis sur le site/app officiel (laposte.fr) en tapant l'adresse vous-même."
  },
  {
    id: 'chronopost',
    channel: 'email',
    brand: 'Chronopost',
    from: 'Chronopost <noreply@chronopost-livraison.net>',
    subject: 'Échec de livraison – reprogrammez votre colis',
    body: `Bonjour,<br><br>Notre livreur est passé aujourd'hui mais personne n'était présent. Pour reprogrammer la livraison, merci de confirmer votre adresse et de régler les <b>2,90 €</b> de frais de présentation.<br><br>{{BUTTON:Reprogrammer ma livraison}}<br><br>Sans action de votre part sous 72h, le colis sera détruit.<br><br>Chronopost France`,
    title: 'Fausse reprogrammation de livraison',
    redFlags: [
      "On vous demande de payer des « frais de présentation » : ça n'existe pas.",
      "Menace disproportionnée : « le colis sera détruit ».",
      "Domaine d'expéditeur douteux (chronopost-livraison.net)."
    ],
    reflex: "Passez par l'app/le site officiel du transporteur. En cas de doute, ne payez rien et ne saisissez aucune carte."
  },
  {
    id: 'ameli',
    channel: 'email',
    brand: 'Ameli – Assurance Maladie',
    from: 'Assurance Maladie <contact@ameli-remboursement.fr>',
    subject: 'Un remboursement de 47,80 € est disponible',
    body: `Bonjour,<br><br>Suite à vos derniers soins, un remboursement de <b>47,80 €</b> est en attente. Pour le percevoir, nous devons vérifier vos informations (carte Vitale et coordonnées bancaires).<br><br>{{BUTTON:Recevoir mon remboursement}}<br><br>Cette demande expire dans 24h.<br><br>L'Assurance Maladie`,
    title: 'Faux remboursement Ameli',
    redFlags: [
      "Ameli ne demande JAMAIS votre RIB ni votre carte Vitale par email.",
      "L'appât du gain (un remboursement) pour vous pousser à cliquer.",
      "Le compte à rebours « expire dans 24h »."
    ],
    reflex: "Connectez-vous uniquement sur ameli.fr (tapé à la main) ou l'app officielle. Ameli ne réclame pas vos coordonnées bancaires par email."
  },
  {
    id: 'impots',
    channel: 'email',
    brand: 'impots.gouv.fr (DGFiP)',
    from: 'DGFiP <noreply@impots-gouv-remboursement.com>',
    subject: 'Remboursement d\'impôt : 132,00 € à percevoir',
    body: `Bonjour,<br><br>Après recalcul de votre dernier avis, vous bénéficiez d'un remboursement de <b>132,00 €</b>. Renseignez vos coordonnées bancaires pour recevoir le virement sous 5 jours.<br><br>{{BUTTON:Obtenir mon remboursement}}<br><br>Direction Générale des Finances Publiques`,
    title: 'Faux remboursement des impôts',
    redFlags: [
      "Le vrai site est impots.gouv.fr ; ici le domaine est falsifié (impots-gouv-remboursement.com).",
      "L'administration fiscale ne demande pas votre RIB par email pour un remboursement.",
      "Promesse d'argent rapide pour créer l'envie de cliquer."
    ],
    reflex: "Allez sur impots.gouv.fr directement. Les remboursements se font sur le compte déjà connu du fisc, sans email de ce type."
  },
  {
    id: 'caf',
    channel: 'email',
    brand: 'CAF',
    from: 'CAF <mon-compte@caf-services.fr>',
    subject: 'Mise à jour requise de votre dossier allocataire',
    body: `Bonjour,<br><br>Votre dossier allocataire présente une information manquante. Sans mise à jour sous 48h, le versement de vos prestations sera suspendu.<br><br>{{BUTTON:Mettre à jour mon dossier}}<br><br>Caisse d'Allocations Familiales`,
    title: 'Fausse mise à jour CAF',
    redFlags: [
      "Menace de « suspension des prestations » pour faire peur.",
      "Domaine non officiel (caf-services.fr au lieu de caf.fr).",
      "Lien qui mène à un formulaire demandant vos identifiants."
    ],
    reflex: "Connectez-vous sur caf.fr ou l'app « Caf – Mon Compte » en tapant l'adresse. Ne mettez jamais à jour vos infos via un lien d'email."
  },
  {
    id: 'banque',
    channel: 'email',
    brand: 'Votre banque',
    from: 'Service Sécurité <securite@alerte-bancaire.net>',
    subject: 'Connexion inhabituelle détectée sur votre compte',
    body: `Bonjour,<br><br>Une connexion depuis un nouvel appareil a été détectée sur votre espace client. Si ce n'est pas vous, sécurisez immédiatement votre compte.<br><br>{{BUTTON:Sécuriser mon compte}}<br><br>Pour votre sécurité, cette alerte expire dans 30 minutes.<br><br>Service Sécurité`,
    title: 'Fausse alerte de sécurité bancaire',
    redFlags: [
      "L'urgence extrême (« 30 minutes ») pour court-circuiter votre réflexion.",
      "Votre banque ne vous fait jamais « sécuriser » via un lien d'email.",
      "Expéditeur générique (alerte-bancaire.net), sans le vrai nom de votre banque."
    ],
    reflex: "Ne cliquez pas. Ouvrez l'app de votre banque ou appelez le numéro au dos de votre carte. Jamais de code ni mot de passe via un lien."
  },
  {
    id: 'netflix',
    channel: 'email',
    brand: 'Netflix',
    from: 'Netflix <info@netflix-compte.com>',
    subject: 'Problème avec votre paiement – mise à jour requise',
    body: `Bonjour,<br><br>Nous n'avons pas pu valider votre dernier paiement. Votre abonnement sera suspendu sous 24h. Merci de mettre à jour votre moyen de paiement.<br><br>{{BUTTON:Mettre à jour mon paiement}}<br><br>L'équipe Netflix`,
    title: 'Faux problème de paiement Netflix',
    redFlags: [
      "Demande de saisir votre carte bancaire via un lien d'email.",
      "Domaine non officiel (netflix-compte.com).",
      "Pression : « suspendu sous 24h »."
    ],
    reflex: "Ouvrez l'app Netflix ou tapez netflix.com. Gérez votre paiement uniquement depuis votre compte, jamais via un lien reçu."
  },
  {
    id: 'amazon',
    channel: 'email',
    brand: 'Amazon',
    from: 'Amazon.fr <commande@amazon-securite.com>',
    subject: 'Confirmation de commande – iPhone 16 Pro (1 329 €)',
    body: `Bonjour,<br><br>Merci pour votre commande : <b>iPhone 16 Pro 256 Go – 1 329,00 €</b>. Livraison estimée demain.<br><br>Vous n'êtes pas à l'origine de cet achat ? Annulez-le immédiatement.<br><br>{{BUTTON:Annuler cette commande}}<br><br>Amazon.fr`,
    title: 'Fausse commande coûteuse (panique)',
    redFlags: [
      "Une commande chère et inattendue pour créer la panique et le clic réflexe.",
      "Domaine falsifié (amazon-securite.com).",
      "Le bouton « Annuler » mène en réalité vers une page piège."
    ],
    reflex: "Ne cliquez pas « Annuler ». Ouvrez l'app Amazon ou amazon.fr et vérifiez « Vos commandes ». Si rien n'y figure, c'est une arnaque."
  },
  {
    id: 'edf',
    channel: 'email',
    brand: 'EDF',
    from: 'EDF <facture@edf-particuliers.net>',
    subject: 'Facture impayée – risque de coupure',
    body: `Bonjour,<br><br>Votre dernière facture d'électricité d'un montant de <b>89,40 €</b> demeure impayée. Pour éviter une coupure sous 72h, régularisez votre situation.<br><br>{{BUTTON:Régulariser ma facture}}<br><br>Service Recouvrement EDF`,
    title: 'Fausse facture impayée EDF',
    redFlags: [
      "Menace de coupure rapide pour vous faire payer dans la précipitation.",
      "Domaine non officiel (edf-particuliers.net).",
      "Aucun détail précis sur votre contrat (numéro client, etc.)."
    ],
    reflex: "Ne payez pas via le lien. Connectez-vous à votre espace EDF (tapé à la main) ou appelez le service client au numéro officiel de vos factures."
  },
  {
    id: 'faux_proche',
    channel: 'sms',
    brand: 'Proche (SMS / WhatsApp)',
    from: 'Numéro inconnu',
    subject: '(SMS) Maman c\'est moi, nouveau numéro',
    body: `Coucou maman, c'est moi 🙂 J'ai cassé mon téléphone, c'est mon nouveau numéro. Je suis embêté(e), je dois régler une facture aujourd'hui mais je n'ai plus accès à mon compte. Tu peux m'avancer 280 € ? Je te rembourse vite. {{BUTTON:Répondre / aider}}`,
    title: 'Arnaque au faux proche',
    redFlags: [
      "Un « proche » qui change de numéro ET demande de l'argent dans la foulée.",
      "L'urgence et l'émotion (« je suis embêté, aujourd'hui »).",
      "On ne vous laisse pas le temps de vérifier."
    ],
    reflex: "Appelez la personne sur son ANCIEN numéro. Tant que vous n'avez pas entendu sa vraie voix, n'envoyez rien et posez une question dont seul le vrai proche a la réponse."
  }
];

const byId = (id) => TEMPLATES.find(t => t.id === id) || null;
const pickRandom = () => TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];

module.exports = { TEMPLATES, byId, pickRandom };
