// ════════════════════════════════════════════
// DESPY — Bibliothèque des messages-test d'entraînement anti-arnaque
// USAGE STRICTEMENT INTERNE & OPT-IN (sensibilisation type "phishing
// simulation", adapté à la famille).
// Sécurité NON négociable :
//   - Le lien {{BUTTON:...}} pointe TOUJOURS vers la page de coaching Despy.
//   - Aucune donnée collectée, aucun vrai risque.
// Les modèles imitent la mise en forme des marques (couleurs, en-tête, pied
// de page) pour être RÉALISTES — c'est ce qui rend l'entraînement utile.
// ════════════════════════════════════════════

const TEMPLATES = [
  {
    id: 'colis_laposte', channel: 'email', brand: 'La Poste',
    subject: 'Votre colis n°LP-883204 est en attente de livraison',
    header: { bg: '#FFCC00', html: '<span style="font-size:22px;font-weight:900;color:#213A8F;letter-spacing:.5px">LA&nbsp;POSTE</span>' },
    btn: { bg: '#213A8F', color: '#ffffff' },
    footer: 'La Poste — Service Clients. Cet email vous est adressé suite à une tentative de livraison. Merci de ne pas y répondre.',
    bodyInner: `<p>Bonjour,</p><p>Votre colis n'a pas pu être livré faute d'affranchissement complet. Des frais de réexpédition de <b>1,99 €</b> restent à régler sous 48h, sans quoi votre colis sera retourné à l'expéditeur.</p><p style="background:#fff8e1;border-left:3px solid #FFCC00;padding:10px 14px;margin:16px 0"><b>Suivi :</b> LP-883204-FR<br><b>Statut :</b> En attente de régularisation</p>{{BUTTON:Régler et programmer la livraison}}<p style="color:#666;font-size:13px">Sans action de votre part, le colis sera automatiquement retourné.</p>`,
    title: 'Faux message de colis (frais à payer)',
    redFlags: [
      "Un petit montant à payer (1,99 €) pour « débloquer » un colis : La Poste ne fonctionne jamais ainsi.",
      "L'adresse de l'expéditeur n'est pas un vrai domaine officiel laposte.fr.",
      "L'urgence : « sous 48h sinon retour » pour vous faire agir vite."
    ],
    reflex: "Ne cliquez pas. Suivez votre colis sur le site/app officiel (laposte.fr) en tapant l'adresse vous-même."
  },
  {
    id: 'chronopost', channel: 'email', brand: 'Chronopost',
    subject: 'Échec de livraison – reprogrammez votre colis',
    header: { bg: '#C2007B', html: '<span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:.5px">Chronopost</span>' },
    btn: { bg: '#C2007B', color: '#ffffff' },
    footer: 'Chronopost France. Notification automatique de livraison. Merci de ne pas répondre à cet email.',
    bodyInner: `<p>Bonjour,</p><p>Notre livreur s'est présenté aujourd'hui à votre domicile, mais personne n'était présent. Pour reprogrammer la livraison, merci de confirmer votre adresse et de régler les <b>2,90 €</b> de frais de présentation.</p>{{BUTTON:Reprogrammer ma livraison}}<p style="color:#666;font-size:13px">Sans action sous 72h, le colis sera retourné à l'expéditeur.</p>`,
    title: 'Fausse reprogrammation de livraison',
    redFlags: [
      "On vous demande de payer des « frais de présentation » : ça n'existe pas.",
      "Menace : « le colis sera retourné/détruit ».",
      "Domaine d'expéditeur douteux, différent du site officiel."
    ],
    reflex: "Passez par l'app/le site officiel du transporteur. Ne payez rien et ne saisissez aucune carte via un lien d'email."
  },
  {
    id: 'ameli', channel: 'email', brand: 'Assurance Maladie',
    subject: 'Un remboursement de 47,80 € est disponible',
    header: { bg: '#0C419A', html: '<span style="font-size:22px;font-weight:800;color:#ffffff">ameli<span style="color:#7FB3E8">.fr</span></span>' },
    btn: { bg: '#0C419A', color: '#ffffff' },
    footer: "l'Assurance Maladie. Ce message est strictement personnel. Pour votre sécurité, ne communiquez jamais vos identifiants.",
    bodyInner: `<p>Bonjour,</p><p>Suite à vos derniers soins, un remboursement de <b>47,80 €</b> est en attente sur votre compte. Pour le percevoir, nous devons vérifier vos informations.</p>{{BUTTON:Recevoir mon remboursement}}<p style="color:#666;font-size:13px">Cette demande expire dans 24h.</p>`,
    title: 'Faux remboursement Ameli',
    redFlags: [
      "Ameli ne demande JAMAIS votre RIB ni votre carte Vitale par email.",
      "L'appât du gain (un remboursement) pour vous pousser à cliquer.",
      "Le compte à rebours « expire dans 24h »."
    ],
    reflex: "Connectez-vous uniquement sur ameli.fr (tapé à la main) ou l'app officielle. Ameli ne réclame pas vos coordonnées bancaires par email."
  },
  {
    id: 'impots', channel: 'email', brand: 'impots.gouv.fr',
    subject: "Remboursement d'impôt : 132,00 € à percevoir",
    header: { bg: '#000091', html: '<span style="font-size:20px;font-weight:800;color:#ffffff">impots.gouv.fr</span>' },
    btn: { bg: '#000091', color: '#ffffff' },
    footer: 'Direction Générale des Finances Publiques (DGFiP). Message automatique, ne pas répondre.',
    bodyInner: `<p>Bonjour,</p><p>Après recalcul de votre dernier avis d'imposition, vous bénéficiez d'un remboursement de <b>132,00 €</b>. Renseignez vos coordonnées bancaires pour recevoir le virement sous 5 jours ouvrés.</p>{{BUTTON:Obtenir mon remboursement}}`,
    title: 'Faux remboursement des impôts',
    redFlags: [
      "Le vrai site est impots.gouv.fr ; ici le domaine d'envoi est falsifié.",
      "L'administration fiscale ne demande pas votre RIB par email pour un remboursement.",
      "Promesse d'argent rapide pour créer l'envie de cliquer."
    ],
    reflex: "Allez sur impots.gouv.fr directement. Les remboursements se font sur le compte déjà connu du fisc, sans email de ce type."
  },
  {
    id: 'caf', channel: 'email', brand: 'Caf',
    subject: 'Mise à jour requise de votre dossier allocataire',
    header: { bg: '#0067A5', html: '<span style="font-size:22px;font-weight:800;color:#ffffff">Caf<span style="color:#9BD3F0">.fr</span></span>' },
    btn: { bg: '#0067A5', color: '#ffffff' },
    footer: "Caisse d'Allocations Familiales. Notification automatique de votre espace allocataire.",
    bodyInner: `<p>Bonjour,</p><p>Votre dossier allocataire présente une information manquante. <b>Sans mise à jour sous 48h, le versement de vos prestations sera suspendu.</b></p>{{BUTTON:Mettre à jour mon dossier}}`,
    title: 'Fausse mise à jour CAF',
    redFlags: [
      "Menace de « suspension des prestations » pour faire peur.",
      "Domaine non officiel (différent de caf.fr).",
      "Lien menant à un formulaire qui réclame vos identifiants."
    ],
    reflex: "Connectez-vous sur caf.fr ou l'app « Caf – Mon Compte » en tapant l'adresse. Jamais via un lien reçu par email."
  },
  {
    id: 'banque', channel: 'email', brand: 'Service Sécurité',
    subject: 'Connexion inhabituelle détectée sur votre compte',
    header: { bg: '#14315B', html: '<span style="font-size:20px;font-weight:800;color:#ffffff">🔒 Service Sécurité Bancaire</span>' },
    btn: { bg: '#C0392B', color: '#ffffff' },
    footer: 'Service de sécurité. Cet email est envoyé pour protéger votre compte.',
    bodyInner: `<p>Bonjour,</p><p>Une connexion depuis un <b>nouvel appareil</b> a été détectée sur votre espace client&nbsp;:</p><p style="background:#f4f6f9;padding:10px 14px;border-radius:6px;font-size:14px;color:#333">Appareil : Android · Localisation : Lille (59)<br>Date : aujourd'hui</p><p>Si ce n'est pas vous, sécurisez immédiatement votre compte.</p>{{BUTTON:Sécuriser mon compte}}<p style="color:#666;font-size:13px">Pour votre sécurité, cette alerte expire dans 30 minutes.</p>`,
    title: 'Fausse alerte de sécurité bancaire',
    redFlags: [
      "L'urgence extrême (« 30 minutes ») pour court-circuiter votre réflexion.",
      "Votre banque ne vous fait jamais « sécuriser » votre compte via un lien d'email.",
      "Expéditeur générique, sans le vrai nom de votre banque."
    ],
    reflex: "Ne cliquez pas. Ouvrez l'app de votre banque ou appelez le numéro au dos de votre carte. Jamais de code ni mot de passe via un lien."
  },
  {
    id: 'netflix', channel: 'email', brand: 'Netflix',
    subject: 'Problème avec votre paiement – mise à jour requise',
    header: { bg: '#000000', html: '<span style="font-size:24px;font-weight:900;color:#E50914;letter-spacing:1px">NETFLIX</span>' },
    btn: { bg: '#E50914', color: '#ffffff' },
    footer: 'Netflix. Vous recevez cet email car vous êtes abonné. Questions ? Consultez le Centre d\'aide.',
    bodyInner: `<p>Bonjour,</p><p>Nous n'avons pas pu valider votre dernier paiement. Votre abonnement sera <b>suspendu sous 24h</b> si vos informations ne sont pas mises à jour.</p>{{BUTTON:Mettre à jour mon paiement}}<p style="color:#666;font-size:13px">Pour continuer à profiter de Netflix sans interruption.</p>`,
    title: 'Faux problème de paiement Netflix',
    redFlags: [
      "Demande de saisir votre carte bancaire via un lien d'email.",
      "Domaine non officiel.",
      "Pression : « suspendu sous 24h »."
    ],
    reflex: "Ouvrez l'app Netflix ou tapez netflix.com. Gérez votre paiement uniquement depuis votre compte, jamais via un lien reçu."
  },
  {
    id: 'amazon', channel: 'email', brand: 'Amazon.fr',
    subject: 'Confirmation de commande – iPhone 16 Pro (1 329,00 €)',
    header: { bg: '#232F3E', html: '<span style="font-size:22px;font-weight:700;color:#ffffff">amazon<span style="color:#FF9900">.fr</span></span>' },
    btn: { bg: '#FF9900', color: '#111111' },
    footer: 'Amazon.fr. Une confidentialité et une sécurité renforcées pour vos achats. Merci de ne pas répondre.',
    bodyInner: `<p>Bonjour,</p><p>Merci pour votre commande.</p><p style="background:#f7f7f7;padding:12px 14px;border-radius:6px;font-size:14px;color:#222"><b>iPhone 16 Pro 256 Go – Titane noir</b><br>Montant : <b>1 329,00 €</b><br>Livraison estimée : demain</p><p><b>Vous n'êtes pas à l'origine de cet achat ?</b> Annulez-le immédiatement.</p>{{BUTTON:Annuler cette commande}}`,
    title: 'Fausse commande coûteuse (panique)',
    redFlags: [
      "Une commande chère et inattendue pour créer la panique et le clic réflexe.",
      "Domaine falsifié, différent d'amazon.fr.",
      "Le bouton « Annuler » mène en réalité vers une page piège."
    ],
    reflex: "Ne cliquez pas « Annuler ». Ouvrez l'app Amazon ou amazon.fr et vérifiez « Vos commandes ». Si rien n'y figure, c'est une arnaque."
  },
  {
    id: 'edf', channel: 'email', brand: 'EDF',
    subject: 'Facture impayée – risque de coupure sous 72h',
    header: { bg: '#001A70', html: '<span style="font-size:22px;font-weight:900;color:#ffffff">EDF</span> <span style="color:#FE5715;font-size:13px;font-weight:700">&nbsp;Particuliers</span>' },
    btn: { bg: '#FE5715', color: '#ffffff' },
    footer: 'EDF — Service Recouvrement. Cet email concerne votre contrat d\'électricité.',
    bodyInner: `<p>Bonjour,</p><p>Votre dernière facture d'électricité d'un montant de <b>89,40 €</b> demeure impayée. Pour éviter une coupure de votre alimentation <b>sous 72h</b>, merci de régulariser votre situation.</p>{{BUTTON:Régulariser ma facture}}`,
    title: 'Fausse facture impayée EDF',
    redFlags: [
      "Menace de coupure rapide pour vous faire payer dans la précipitation.",
      "Domaine non officiel.",
      "Aucun détail précis sur votre contrat (numéro client, références)."
    ],
    reflex: "Ne payez pas via le lien. Connectez-vous à votre espace EDF (tapé à la main) ou appelez le service client au numéro de vos factures."
  },
  {
    id: 'faux_proche', channel: 'sms', brand: 'Maman ❤️',
    subject: '(Message) Maman c\'est moi, nouveau numéro',
    bodyInner: `Coucou maman c'est moi 🙂 j'ai cassé mon téléphone, c'est mon nouveau numéro. Je suis un peu embêté(e), je dois régler une facture aujourd'hui mais je n'ai plus accès à mon compte. Tu peux m'avancer 280 € stp ? Je te rembourse vite 🙏 {{BUTTON:Voir comment t'aider}}`,
    title: 'Arnaque au faux proche',
    redFlags: [
      "Un « proche » qui change de numéro ET demande de l'argent dans la foulée.",
      "L'urgence et l'émotion (« je suis embêté, aujourd'hui »).",
      "On ne vous laisse pas le temps de vérifier."
    ],
    reflex: "Appelez la personne sur son ANCIEN numéro. Tant que vous n'avez pas entendu sa vraie voix, n'envoyez rien et posez une question dont seul le vrai proche a la réponse."
  }
];

// Construit l'email réaliste (chrome de marque) à partir du modèle + lien de coaching.
function renderEmail(tpl, link) {
  if (tpl.channel === 'sms') {
    const inner = tpl.bodyInner.replace(/\{\{BUTTON:([^}]+)\}\}/g, (_, l) =>
      `<br><br><a href="${link}" style="color:#2563eb;text-decoration:underline">${l.trim()}</a>`);
    return `<div style="background:#e5e5ea;padding:26px 12px;font-family:-apple-system,Helvetica,Arial,sans-serif">
      <div style="max-width:420px;margin:0 auto">
        <div style="text-align:center;font-size:12px;color:#8a8a8e;margin-bottom:12px">Message texte · maintenant</div>
        <div style="background:#fff;border-radius:18px;padding:14px 16px;font-size:15px;color:#111;line-height:1.5">${inner}</div>
        <div style="text-align:center;font-size:11px;color:#aaa;margin-top:14px">— Test d'entraînement Despy —</div>
      </div></div>`;
  }
  const b = tpl.btn || { bg: '#2D5BFF', color: '#fff' };
  const pre = tpl.bodyInner.replace(/\{\{BUTTON[^}]*\}\}/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  const inner = tpl.bodyInner.replace(/\{\{BUTTON:([^}]+)\}\}/g, (_, l) =>
    `<div style="text-align:center;margin:24px 0"><a href="${link}" style="display:inline-block;background:${b.bg};color:${b.color};padding:14px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px">${l.trim()}</a></div>`);
  const yr = new Date().getFullYear();
  return `<div style="background:#f0f0f0;padding:20px 0;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f0f0f0;font-size:1px;line-height:1px">${pre}</div>
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e3e3e3">
      <div style="background:${tpl.header.bg};padding:18px 24px">${tpl.header.html}</div>
      <div style="padding:26px 24px;font-size:15px;color:#222;line-height:1.6">${inner}</div>
      <div style="padding:18px 24px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#999;line-height:1.6">
        ${tpl.footer || ''}<br><br>
        <a href="${link}" style="color:#999;text-decoration:underline">Se désabonner</a> &nbsp;·&nbsp; <a href="${link}" style="color:#999;text-decoration:underline">Gérer mes préférences</a> &nbsp;·&nbsp; Aide<br>
        © ${yr} ${tpl.brand}. Tous droits réservés.
      </div>
    </div></div>`;
}

const byId = (id) => TEMPLATES.find(t => t.id === id) || null;
const pickRandom = () => TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé, pas un endpoint
module.exports = { TEMPLATES, byId, pickRandom, renderEmail, handler };
