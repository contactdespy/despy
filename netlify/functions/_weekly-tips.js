// ════════════════════════════════════════════
// DESPY — Conseils hebdomadaires (source unique)
// Partagé par weekly-report.js (envoi) et tip-done.js (suivi).
// Chaque conseil a un `id` STABLE : ne jamais le renommer, sinon
// la progression des abonnés (conseils déjà validés) serait perdue.
// ════════════════════════════════════════════

// Mini-guides premium : C'est quoi ? · Pourquoi ? · Comment faire.
// Français simple, vouvoiement, sans jargon — public senior.
const WEEKLY_TIPS = [
  {
    id: "2fa-email",
    titre: "🔐 La double authentification de votre boîte mail",
    quoi: "Une deuxième clé de sécurité en plus de votre mot de passe : un code unique reçu par SMS à chaque nouvelle connexion. Même si un pirate devine votre mot de passe, il reste bloqué sans votre téléphone.",
    pourquoi: "Votre boîte mail est la porte d'entrée vers tout le reste : banque, impôts, achats. La protéger, c'est tout protéger d'un seul geste.",
    comment: [
      "Gmail : cliquez sur votre photo en haut à droite → « Gérer votre compte Google » → onglet « Sécurité » → « Validation en deux étapes » → laissez-vous guider.",
      "Outlook / Hotmail : allez sur account.microsoft.com → « Sécurité » → « Vérification en deux étapes » → activez-la.",
      "Gardez votre téléphone à côté de vous : vous recevrez un code à recopier lors de la première connexion."
    ]
  },
  {
    id: "sms-colis",
    titre: "📦 Le faux SMS « votre colis est en attente »",
    quoi: "Un SMS qui imite Chronopost, La Poste ou Colissimo et vous demande de payer une petite somme (1 à 3 €) pour « libérer » un colis, en cliquant sur un lien.",
    pourquoi: "Le but n'est pas les 2 € : c'est de voler votre numéro de carte bancaire, qu'ils réutiliseront ensuite pour de gros prélèvements.",
    comment: [
      "Ne cliquez sur aucun lien contenu dans un SMS de livraison.",
      "Un vrai transporteur ne demande jamais de payer par SMS.",
      "En cas de doute, collez le SMS sur despy.fr pour le vérifier, ou tapez vous-même l'adresse officielle du transporteur."
    ]
  },
  {
    id: "mot-de-passe",
    titre: "🔑 Un mot de passe vraiment solide",
    quoi: "Un mot de passe long et différent pour chaque site important. Une astuce simple : une phrase facile à retenir, comme « MonChatDort8surLeCanapé! ».",
    pourquoi: "Si vous utilisez le même mot de passe partout, un seul site piraté suffit à donner accès à tous vos comptes.",
    comment: [
      "Choisissez une phrase d'au moins 12 caractères, avec une majuscule, un chiffre et un signe.",
      "Ne réutilisez jamais le même mot de passe sur deux comptes sensibles (banque, boîte mail).",
      "Pour ne pas tout retenir, laissez le gestionnaire de mots de passe de votre navigateur les garder en sécurité."
    ]
  },
  {
    id: "faux-conseiller-bancaire",
    titre: "📞 Le faux conseiller bancaire",
    quoi: "Un appel d'une personne très rassurante qui prétend être du « service anti-fraude » de votre banque et réclame un code reçu par SMS, ou un virement « de sécurité ».",
    pourquoi: "C'est l'arnaque la plus coûteuse pour les seniors. Une fois le code communiqué, un compte peut être vidé en quelques minutes.",
    comment: [
      "Votre banque ne vous demandera JAMAIS un code SMS ni un virement par téléphone.",
      "Raccrochez, même si la personne semble pressée ou menaçante.",
      "Rappelez vous-même le numéro inscrit au dos de votre carte bancaire pour vérifier."
    ]
  },
  {
    id: "mises-a-jour",
    titre: "🔄 Les mises à jour de vos appareils",
    quoi: "Les messages « une mise à jour est disponible » qui apparaissent sur votre téléphone ou votre ordinateur.",
    pourquoi: "Ces mises à jour bouchent des failles que les pirates utilisent pour entrer. Les ignorer, c'est laisser une fenêtre ouverte.",
    comment: [
      "Quand votre appareil propose une mise à jour, acceptez-la (idéalement le soir, branché au secteur).",
      "Activez les mises à jour automatiques si l'option est proposée.",
      "Méfiez-vous des fausses mises à jour qui surgissent en naviguant : les vraies viennent des réglages de l'appareil, jamais d'une page web."
    ]
  },
  {
    id: "verifier-url",
    titre: "🌐 Vérifier qu'un site est le bon",
    quoi: "Avant de saisir un mot de passe ou un numéro de carte, contrôler l'adresse (l'URL) affichée tout en haut de la page.",
    pourquoi: "Les pirates créent de fausses pages identiques à celles de votre banque ou des impôts pour récupérer ce que vous tapez.",
    comment: [
      "Vérifiez la présence d'un petit cadenas à gauche de l'adresse.",
      "Lisez l'adresse en entier : « impots.gouv.fr » est officiel, « impots-gouv-remboursement.com » ne l'est pas.",
      "Dans le doute, tapez vous-même l'adresse du site plutôt que de cliquer sur un lien reçu."
    ]
  },
  {
    id: "faux-support-technique",
    titre: "💻 Le faux « support technique »",
    quoi: "Une fenêtre rouge qui surgit sur votre écran : « Votre ordinateur est infecté ! Appelez ce numéro Microsoft. » Au bout du fil, un faux technicien.",
    pourquoi: "Ils vous font payer un faux dépannage et prennent le contrôle de votre ordinateur à distance pour voler vos données.",
    comment: [
      "Microsoft, Apple ou Orange ne mettent JAMAIS un numéro à appeler dans une fenêtre d'alerte.",
      "Ne composez pas le numéro. Fermez la page, ou éteignez puis rallumez l'ordinateur.",
      "Ne laissez jamais quelqu'un prendre la main à distance sur votre ordinateur s'il vous a appelé sans que vous l'ayez demandé."
    ]
  },
  {
    id: "arnaque-sentimentale",
    titre: "💔 L'arnaque aux sentiments",
    quoi: "Une belle rencontre sur Internet ou Facebook qui, après quelques semaines, finit toujours par réclamer de l'argent (santé, billet d'avion, douane bloquée).",
    pourquoi: "Ces escrocs sont patients et très convaincants. Les sommes perdues se comptent souvent en milliers d'euros.",
    comment: [
      "Une personne qui demande de l'argent sans vous avoir jamais rencontré en vrai est presque toujours un escroc.",
      "Refusez tout virement, recharge ou carte cadeau, même face à l'insistance.",
      "Parlez-en à un proche : un regard extérieur voit souvent ce que le cœur ne veut pas voir."
    ]
  },
  {
    id: "sauvegardes",
    titre: "💾 Sauvegarder vos photos et documents",
    quoi: "Garder une copie de vos fichiers importants ailleurs que sur votre seul appareil.",
    pourquoi: "En cas de vol, de panne ou de virus qui bloque vos fichiers, vous ne perdez rien d'irremplaçable.",
    comment: [
      "Copiez vos photos importantes sur une clé USB ou un disque externe de temps en temps.",
      "Ou activez la sauvegarde automatique dans le « nuage » (iCloud pour iPhone, Google Photos pour Android).",
      "Vérifiez une fois par an que vous savez bien retrouver vos fichiers sauvegardés."
    ]
  },
  {
    id: "verifier-fuites",
    titre: "🔎 Vérifier si vos données ont fuité",
    quoi: "Quand un site que vous utilisez se fait pirater, votre email et parfois votre mot de passe se retrouvent dans la nature.",
    pourquoi: "Les pirates achètent ces listes pour tenter d'entrer dans vos autres comptes. Savoir, c'est pouvoir réagir à temps.",
    comment: [
      "Rendez-vous sur despy.fr et ouvrez l'outil gratuit de vérification des fuites.",
      "Entrez votre adresse email : Despy vous dit si elle apparaît dans une fuite connue.",
      "Si c'est le cas, changez sans attendre le mot de passe du compte concerné."
    ]
  },
  {
    id: "arnaque-proche-ia",
    titre: "🤖 « Mamie, c'est moi, j'ai un problème… »",
    quoi: "Un appel ou un message d'un proche en détresse qui réclame de l'argent en urgence. Aujourd'hui, des escrocs imitent même la voix grâce à l'intelligence artificielle.",
    pourquoi: "La panique fait baisser la garde. C'est exactement ce que recherche l'escroc pour vous faire payer vite.",
    comment: [
      "Avant tout envoi d'argent, raccrochez et rappelez votre proche sur SON vrai numéro habituel.",
      "Posez une question dont seul le vrai proche connaît la réponse.",
      "Convenez en famille d'un « mot de passe » secret à demander en cas de doute."
    ]
  },
  {
    id: "wifi-public",
    titre: "📶 Les réseaux Wi-Fi publics",
    quoi: "Les Wi-Fi gratuits des gares, cafés ou hôtels, ouverts à tout le monde.",
    pourquoi: "Sur ces réseaux ouverts, une personne mal intentionnée peut parfois voir ce que vous faites, y compris vos mots de passe.",
    comment: [
      "Évitez de consulter votre banque ou de faire un achat connecté à un Wi-Fi public.",
      "Pour ces opérations sensibles, utilisez plutôt les données de votre téléphone (4G/5G).",
      "Désactivez la connexion automatique aux Wi-Fi inconnus dans les réglages de votre téléphone."
    ]
  }
];

// Numéro de semaine ISO (1-53) — garantit un point de départ qui change
// chaque semaine, contrairement à getDay() qui valait toujours 1 le lundi.
function getIsoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

// Map id → conseil (lookup rapide pour tip-done.js)
const TIPS_BY_ID = WEEKLY_TIPS.reduce((m, t) => { m[t.id] = t; return m; }, {});

module.exports = { WEEKLY_TIPS, TIPS_BY_ID, getIsoWeek };
