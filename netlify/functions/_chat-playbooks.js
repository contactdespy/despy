// ════════════════════════════════════════════
// DESPY — Réponses verrouillées du Conseiller
// ════════════════════════════════════════════
// Sur les situations où de l'argent est en jeu, le Conseiller ne génère
// RIEN : il sert une réponse écrite à la main, relue et validée. L'IA ne
// reprend la main que sur le reste (despy-chat.js).
//
// Pourquoi : une phrase approximative sur un remboursement bancaire, dite
// à une personne inquiète, devient une promesse que nous ne tenons pas.
//
// ⚠️ Les tournures juridiques ci-dessous sont volontairement prudentes
//    (« sauf négligence grave », « pas automatique »). Ne pas les durcir
//    sans relecture.
//
// Lot 1/2 : les 5 situations « argent en mouvement ».
// À venir : compte piraté, usurpation d'identité, données exposées,
// arnaque sentimentale, chantage webcam, faux support, analyse de message.

// ── Rappel humain : plage d'engagement ──
// Hors de ces heures on ne promet pas l'immédiat, on annonce le lendemain.
const CALLBACK_START = 9;   // 9 h
const CALLBACK_END   = 20;  // 20 h (dernier rappel lancé à 19 h 59)

const LIENS = {
  oppositionCarte : '0 892 705 705 (serveur interbancaire, 24 h/24)',
  perceval        : 'perceval.gouv.fr',
  cyber           : 'cybermalveillance.gouv.fr',
  sms             : '33700',
  victimes        : '116 006 (France Victimes, gratuit)',
};

// ─────────────────────────────────────────────
// Les fiches
// ─────────────────────────────────────────────
const PLAYBOOKS = [

  // 0 ─────────────────────────────────────────
  // Placée en tête : quand le client répond « appelez-moi » à une fiche, cette
  // réponse doit gagner sur toutes les autres. Elle ne promet rien qu'on ne
  // sache tenir : le rappel part du bouton SOS, qui collecte le numéro et
  // alerte un conseiller immédiatement.
  {
    id: 'demande-rappel',
    label: 'Le client demande à être rappelé',
    money: false,
    escalate: false,
    norelais: true,
    match: [
      /^\s*(oui[ ,!.]*)?(appelez|rappelez)[- ]?moi/i,
      /(je veux|j'aimerais|je souhaite|je pr[ée]f[èe]re).{0,25}(être|etre) rappel/i,
      /(pouvez|pourriez)[- ]vous m'appeler/i,
      /(appelez|rappelez)[- ]moi (tout de suite|maintenant|vite|s'il vous pla[îi]t)/i,
    ],
    calme:
      "C'est noté. Pour lancer le rappel il me faut votre numéro, et je ne l'ai pas dans cette conversation — " +
      "voici le chemin le plus rapide :",
    gestes: [
      "Touchez le bouton **SOS — parler à un humain**, en bas de l'écran.",
      "Indiquez votre numéro, et en une phrase ce qui vous arrive.",
      "C'est tout. L'alerte part immédiatement sur le téléphone d'un conseiller.",
    ],
    droit:
      "Si vous ne trouvez pas le bouton, écrivez-nous à contact.despy@gmail.com avec votre numéro " +
      "et le mot « urgent » en objet — c'est lu tout de suite.",
    chips: [
      { t: '📞 Ouvrir le SOS', action: 'sos' },
    ],
  },

  // 1 ─────────────────────────────────────────
  {
    id: 'carte-saisie',
    label: 'Carte bancaire saisie sur un faux site',
    money: true,
    match: [
      /(donn[ée]|saisi|tap[ée]|rentr[ée]|mis|communiqu[ée]|renseign[ée]).{0,30}(num[ée]ro de )?(ma |la )?carte/i,
      /carte.{0,25}(bancaire|bleue).{0,30}(sur|dans).{0,20}(site|page|lien|formulaire)/i,
      /(faux site|site frauduleux|fausse page).{0,40}carte/i,
      /(j'ai pay[ée]|j'ai r[ée]gl[ée]).{0,30}(frais|douane|colis).{0,20}(lien|sms)/i,
    ],
    calme:
      "Respirez, on va faire ça dans l'ordre. Tant qu'aucun paiement n'est passé, il n'y a rien de perdu — " +
      "et même si un paiement passe, il se conteste.",
    gestes: [
      "**Bloquez la carte tout de suite** : depuis votre application bancaire (« bloquer ma carte »), ou en appelant le " + LIENS.oppositionCarte + ". C'est immédiat et réversible.",
      "**Ne validez aucun code reçu par SMS** dans les heures qui suivent. L'escroc va essayer de faire passer un paiement : sans votre validation, il échoue.",
      "**Signalez sur " + LIENS.perceval + "** — c'est le service de la gendarmerie pour la fraude à la carte. Pas besoin de vous déplacer, et cela ne remplace pas votre banque : faites les deux.",
      "**Regardez vos opérations pendant 3 jours.** Les escrocs testent souvent avec 1 € avant de prélever davantage.",
    ],
    droit:
      "Ce que dit la loi : votre banque doit vous rembourser les paiements que vous n'avez pas autorisés, " +
      "sauf si elle démontre une négligence grave de votre part. Vous avez 13 mois pour les contester.",
    chips: [
      "Je n'arrive pas à joindre ma banque",
      "Un paiement est déjà passé",
      "Je n'ai donné que le numéro, sans le code",
    ],
  },

  // 2 ─────────────────────────────────────────
  {
    id: 'prelevement-inconnu',
    label: 'Prélèvement inconnu sur le compte',
    money: true,
    match: [
      /pr[ée]l[èe]vement.{0,40}(inconnu|bizarre|pas reconnu|jamais autoris|louche|comprends pas)/i,
      /(soci[ée]t[ée]|nom|libell[ée]).{0,30}(inconnu|que je ne connais pas).{0,30}(compte|relev[ée])/i,
      /on m'a pr[ée]lev[ée]/i,
      /(d[ée]bit|somme|montant).{0,30}(que je n'ai pas|jamais) (autoris|command|demand)/i,
    ],
    calme:
      "Un prélèvement, ce n'est pas de l'argent perdu : cela se conteste et cela se rembourse. " +
      "Prenez juste le temps de noter ce que vous voyez.",
    gestes: [
      "**Notez trois choses** : le libellé exact (le nom qui s'affiche), le montant, et la date. C'est tout ce que votre banque demandera.",
      "**Demandez le remboursement à votre banque** — par téléphone ou depuis la messagerie de votre application. Le mot à employer : « je conteste un prélèvement non autorisé ».",
      "**Faites bloquer le mandat** dans la foulée, sinon le même prélèvement revient le mois suivant. Vous pouvez aussi demander une « liste blanche » : seuls les organismes que vous avez validés pourront prélever.",
      "**Remontez sur 3 mois** de relevés : s'il y a eu un test à 1 € ou 2 €, il faut le contester aussi.",
    ],
    droit:
      "Ce que dit la loi : un prélèvement que vous n'avez jamais autorisé se conteste pendant 13 mois. " +
      "Un prélèvement que vous aviez autorisé mais que vous contestez : 8 semaines, sans avoir à vous justifier.",
    chips: [
      "Ma banque refuse de rembourser",
      "Comment je demande la liste blanche ?",
      "Préparez-moi le courrier",
    ],
  },

  // 3 ─────────────────────────────────────────
  {
    id: 'virement-parti',
    label: 'Virement déjà effectué vers un escroc',
    money: true,
    match: [
      /(j'ai (fait|effectu[ée]|envoy[ée]|valid[ée])).{0,30}virement/i,
      /virement.{0,40}(escroc|arnaque|faux|frauduleux|mauvais compte|autre compte)/i,
      /(envoy[ée]|vir[ée]|transf[ée]r[ée]).{0,20}(de l'argent|\d+ ?(€|euros))/i,
      /compte (s[ée]curis[ée]|de mise en s[ée]curit[ée])/i,
      // Virement + contexte de fraude, quelle que soit la tournure (« on m'a
      // piraté mon compte et fait un virement »). L'argent qui part prime sur
      // les autres fiches, d'où la position de celle-ci dans la liste.
      /(?=.*virement)(?=.*(escroc|arnaque|pirat|frauduleux|sans mon accord|[àa] mon insu|faux conseiller))/is,
      // Faux RIB fournisseur : l'ordre des mots varie beaucoup, et il faut que
      // le changement vienne d'un tiers (« avait été modifié »), pas du client.
      /(?=.*\b(rib|iban)\b)(?=.*(a [ée]t[ée] (modifi|chang)|avait [ée]t[ée] (modifi|chang)|nouveau rib|nouvel iban|a chang[ée]|on m'a (envoy|donn|transmis)))/is,
    ],
    calme:
      "C'est la situation la plus difficile, je ne vais pas vous raconter d'histoires — mais tout se joue " +
      "dans l'heure qui vient. On y va maintenant, ensemble.",
    gestes: [
      "**Appelez votre banque immédiatement** et demandez le « rappel du virement » (recall). S'il n'est pas encore exécuté, il peut parfois être arrêté. C'est la seule action qui compte dans les premières minutes.",
      "**N'envoyez surtout pas un second virement.** L'escroc va vous rappeler en parlant d'une erreur à corriger : c'est la suite de l'arnaque.",
      "**Portez plainte** — au commissariat ou à la gendarmerie, ou en ligne pour une escroquerie sur internet. Gardez tout : SMS, mails, numéros, RIB, captures d'écran.",
      "**Signalez sur " + LIENS.cyber + "**, et si vous vous sentez ébranlé, le " + LIENS.victimes + " vous écoute — c'est fait pour ça, et c'est gratuit.",
    ],
    droit:
      "Soyons honnêtes : un virement que vous avez validé vous-même n'est pas remboursé automatiquement. " +
      "Mais un recours reste possible, en particulier si l'escroc s'est fait passer pour votre banque. " +
      "Ne portez pas ce dossier seul.",
    chips: [
      "La banque dit que c'est ma faute",
      "Comment je porte plainte ?",
      "Il me redemande de l'argent",
    ],
  },

  // 4 ─────────────────────────────────────────
  {
    id: 'faux-conseiller-tel',
    label: 'Faux conseiller bancaire au téléphone',
    money: true,
    match: [
      /(quelqu'un|un homme|une femme|on).{0,40}(appel|t[ée]l[ée]phon).{0,50}(banque|conseiller|service (fraude|s[ée]curit[ée]))/i,
      /(faux|soi-disant|pr[ée]tend).{0,20}conseiller/i,
      // « téléphoné » ne contient pas « téléphone » : on s'arrête au radical.
      /(service|d[ée]partement).{0,15}(anti-?fraude|fraude).{0,30}(appel|t[ée]l[ée]phon)/i,
      /au t[ée]l[ée]phone.{0,40}(code|virement|carte)/i,
    ],
    calme:
      "Si la personne est encore en ligne : **raccrochez maintenant**. Vous ne risquez absolument rien à raccrocher, " +
      "et un vrai conseiller ne vous en voudra jamais de vérifier.",
    gestes: [
      "**Ne validez rien dans votre application bancaire** tant que vous êtes au téléphone. Aucune notification, aucun code, aucune empreinte.",
      "**Rappelez vous-même** le numéro inscrit au dos de votre carte — jamais le numéro qu'on vous a donné, jamais en rappelant le dernier appel. Si vous le pouvez, utilisez un autre téléphone.",
      "**Si vous avez déjà donné quelque chose** (code, numéro de carte, validation) : bloquez la carte tout de suite, au " + LIENS.oppositionCarte + ".",
      "**Signalez l'appel au " + LIENS.sms + "** (gratuit) : cela aide à faire couper ces numéros.",
    ],
    droit:
      "Trois phrases qu'une vraie banque ne prononce jamais : « donnez-moi le code reçu par SMS », " +
      "« virez votre argent sur un compte sécurisé », « validez la notification pour annuler l'opération ». " +
      "Si vous les entendez, c'est une arnaque, à 100 %.",
    chips: [
      "J'ai donné un code par téléphone",
      "Il rappelle sans arrêt",
      "Comment il connaissait mes informations ?",
    ],
  },

  // 5 ─────────────────────────────────────────
  {
    id: 'code-sms-donne',
    label: 'Code de validation communiqué à un tiers',
    money: true,
    match: [
      /(donn[ée]|dict[ée]|communiqu[ée]|transmis|dit).{0,30}(le |mon |un )?code.{0,25}(sms|re[çc]u|validation|confirmation|s[ée]curit[ée])/i,
      /code.{0,20}(3d ?secure|à 6 chiffres|de v[ée]rification).{0,30}(donn[ée]|envoy[ée]|dit)/i,
      /(il|elle) m'a demand[ée].{0,20}le code/i,
    ],
    calme:
      "Un code seul ne vide pas un compte : il valide **une opération précise**, et cette opération est écrite " +
      "dans le SMS que vous avez reçu. On va donc commencer par le relire.",
    gestes: [
      "**Rouvrez le SMS** et lisez la ligne du montant et du bénéficiaire. C'est exactement ce qui a été validé — ni plus, ni moins.",
      "**Appelez votre banque** et signalez l'opération comme non autorisée. Si elle n'est pas encore passée, elle peut souvent être bloquée.",
      "**Changez le mot de passe de votre espace bancaire**, depuis l'application et non depuis un lien.",
      "**Refusez toute nouvelle demande**, même si la personne rappelle en s'excusant ou en parlant d'une erreur technique.",
    ],
    droit:
      "Important : le fait d'avoir communiqué un code peut être présenté par la banque comme une négligence. " +
      "Ne dites jamais que vous « avez donné votre accord » — vous avez été trompé, ce n'est pas la même chose. " +
      "Un conseiller vous aide à formuler la contestation.",
    chips: [
      "Le paiement est passé",
      "Ma banque parle de négligence",
      "Comment je change mon mot de passe ?",
    ],
  },

  // 6 ─────────────────────────────────────────
  {
    id: 'compte-pirate',
    label: 'Boîte mail ou compte piraté',
    money: false,
    escalate: false,
    match: [
      /(compte|bo[îi]te mail|messagerie|facebook|instagram|whatsapp|gmail|outlook).{0,40}(pirat|hack|vol[ée]|usurp)/i,
      // Tournure inverse, très courante : « on m'a piraté mon compte ».
      /(pirat|hack).{0,30}(mon|ma|le|la) (compte|bo[îi]te|messagerie|mail|page)/i,
      /(quelqu'un|on).{0,25}(est dans|utilise|s'est connect[ée] [àa]).{0,25}(mon compte|ma bo[îi]te|ma messagerie)/i,
      /mot de passe.{0,30}(chang[ée] sans|ne (fonctionne|marche) plus)/i,
      /je n'arrive plus [àa] me connecter.{0,30}(compte|mail|messagerie|facebook)/i,
      /mes (contacts|amis) ont re[çc]u.{0,30}(message|mail).{0,20}(de ma part|de moi)/i,
    ],
    calme:
      "Un compte piraté, ça se récupère — et on va s'y prendre dans le bon ordre. " +
      "On commence par la boîte mail : c'est elle qui commande tous vos autres comptes.",
    gestes: [
      "**Changez le mot de passe de votre boîte mail en premier**, depuis l'application ou en tapant vous-même l'adresse du site. Jamais depuis un lien reçu par message.",
      "**Déconnectez tous les appareils** : dans les réglages de sécurité, cherchez « appareils connectés » puis « tout déconnecter ». L'intrus est éjecté immédiatement.",
      "**Activez la double authentification.** C'est la seule mesure qui l'empêche de revenir, même si votre mot de passe refuit un jour.",
      "**Vérifiez les règles de messagerie et l'adresse de secours.** C'est l'étape que tout le monde oublie : les escrocs laissent souvent un renvoi automatique pour continuer à lire votre courrier après votre changement de mot de passe.",
    ],
    droit:
      "Prévenez vos proches que votre compte a été utilisé : c'est presque toujours à eux que l'escroc écrira ensuite, " +
      "en se faisant passer pour vous. Le signalement se fait sur " + LIENS.cyber + ".",
    chips: [
      "Je n'arrive plus du tout à me connecter",
      "Comment j'active la double authentification ?",
      "Mes contacts ont reçu des messages",
    ],
  },

  // 7 ─────────────────────────────────────────
  {
    id: 'usurpation-identite',
    label: 'Usurpation d’identité (crédit ou abonnement ouvert au nom du client)',
    money: true,
    escalate: true,
    match: [
      /usurpation|usurp[ée].{0,20}(identit[ée]|nom)/i,
      /(cr[ée]dit|pr[êe]t|abonnement|forfait|compte|contrat).{0,40}(ouvert|souscrit|sign[ée]).{0,25}(sans moi|[àa] mon nom|en mon nom|que je n'ai pas)/i,
      /(je re[çc]ois|on me r[ée]clame).{0,40}(facture|[ée]ch[ée]ance|remboursement).{0,30}(je n'ai jamais|jamais command|pas [àa] moi)/i,
      /(fich[ée]|inscrit).{0,20}banque de france/i,
      /(mes|ses) papiers.{0,30}(vol[ée]|utilis[ée]|copi[ée])/i,
    ],
    calme:
      "C'est long et profondément injuste, mais ça se règle : vous n'aurez pas à payer un contrat que vous n'avez pas signé. " +
      "Il faut simplement monter le dossier dans le bon ordre.",
    gestes: [
      "**Portez plainte en premier.** C'est la pièce maîtresse : sans récépissé de plainte, aucun organisme ne bougera. Commissariat, gendarmerie, ou plainte en ligne pour une escroquerie sur internet.",
      "**Écrivez à l'organisme en recommandé** (banque, opérateur, société de crédit), récépissé joint, avec cette phrase : « je conteste ce contrat, je n'en suis pas signataire ».",
      "**Vérifiez si vous êtes fiché** auprès de la Banque de France — la consultation est gratuite et c'est ce fichier qui bloquerait vos futurs crédits.",
      "**Rassemblez tout dans un seul dossier daté** : courriers, mails, relevés, numéros de contrat. Vous en aurez besoin pendant plusieurs mois.",
    ],
    droit:
      "Ce que dit la loi : un contrat signé par un tiers avec vos papiers ne vous engage pas, et ce n'est pas à vous de prouver " +
      "que ce n'est pas vous — c'est à l'organisme de démontrer que c'est bien vous qui avez signé.",
    chips: [
      "Comment je porte plainte ?",
      "Ils continuent à me réclamer l'argent",
      "Je suis fiché à la Banque de France",
    ],
  },

  // 8 ─────────────────────────────────────────
  {
    id: 'donnees-exposees',
    label: 'Données personnelles exposées (alerte dark web)',
    money: false,
    escalate: false,
    match: [
      /(mes )?donn[ée]es.{0,40}(fuit|expos|dark web|circul|natur|violation|divulgu)/i,
      /(adresse mail|e-?mail|num[ée]ro|iban|mot de passe).{0,40}(dark web|fuite|fuit[ée]|expos[ée]|piratage)/i,
      /j'ai re[çc]u une alerte.{0,40}(donn[ée]es|fuite|dark web|s[ée]curit[ée])/i,
      /(have i been pwned|hibp)/i,
    ],
    calme:
      "Vos données circulent, ce n'est jamais agréable — mais tant qu'aucun mot de passe n'est concerné, " +
      "personne ne peut se connecter à votre place. Le vrai risque, c'est qu'on vous contacte en ayant l'air de vous connaître.",
    gestes: [
      "**Regardez ce qui a fuité exactement**, c'est écrit dans l'alerte. Un mot de passe se change ; un nom, un e-mail ou un numéro se surveillent, mais ne se changent pas.",
      "**Si un mot de passe est concerné, changez-le partout où vous l'utilisiez.** C'est la réutilisation du même mot de passe qui transforme une petite fuite en gros problème.",
      "**Attendez-vous à des appels et SMS « bien informés »** dans les semaines qui viennent. Personne de sérieux ne vous demandera jamais un code ou un virement.",
      "**Ne répondez pas à ces messages, même pour dire STOP.** Répondre confirme que votre numéro est actif. Transférez-les au " + LIENS.sms + ", puis supprimez.",
    ],
    droit:
      "De notre côté, la demande de suppression a déjà été envoyée au courtier qui héberge le lot, et vous serez prévenu de sa réponse. " +
      "La surveillance de votre e-mail et de votre numéro reste active : si vos données ressortent ailleurs, vous le saurez avant que ça n'aille plus loin.",
    chips: [
      "Quel mot de passe je dois changer ?",
      "Je reçois beaucoup d'appels depuis",
      "Comment on fait supprimer mes données ?",
    ],
  },

  // 9 ─────────────────────────────────────────
  {
    id: 'arnaque-sentimentale',
    label: 'Arnaque sentimentale ou au faux proche',
    money: true,
    escalate: true,
    match: [
      /(rencontr[ée]|site de rencontre|amoureu|fianc[ée]|copain|copine|relation).{0,70}(argent|virement|carte cadeau|bitcoin|cryptomonnaie|douane|billet)/i,
      /(faux proche|faux fils|faux enfant)/i,
      /(mon fils|ma fille|maman|papa|mon petit-fils).{0,50}(nouveau num[ée]ro|chang[ée] de num[ée]ro)/i,
      /(militaire|chirurgien|plateforme|sur internet).{0,50}(demande|r[ée]clame).{0,30}(argent|virement)/i,
      // Pluriel fréquent (« cartes cadeaux ») et ordre des mots libre. On exige
      // que la demande vienne d'un tiers, sinon « acheter une carte cadeau pour
      // mon petit-fils » déclencherait la fiche.
      /(?=.*(cartes? cadeaux?|transcash|pcs|bitcoin|cryptomonnaie))(?=.*(on m'a demand|m'a demand|me demande|m'a dit d'achet|r[ée]clame|exige))/is,
    ],
    calme:
      "Je vais être direct, parce que c'est ce qui vous aidera : si quelqu'un que vous n'avez jamais rencontré en vrai " +
      "vous demande de l'argent, c'est une arnaque. Sans exception. Et cela ne dit rien de votre intelligence — " +
      "ces réseaux sont organisés et entraînés pour ça.",
    gestes: [
      "**N'envoyez plus rien** : ni virement, ni carte cadeau, ni cryptomonnaie. Ce sont exactement les trois moyens qu'ils réclament, parce qu'ils sont irrécupérables.",
      "**Si c'est un proche qui écrit d'un « nouveau numéro » : appelez-le sur son ancien numéro.** Toujours. C'est aujourd'hui l'arnaque la plus répandue en France.",
      "**Gardez tout** : messages, photos, numéros, RIB, pseudo du profil. Ce sont des preuves, et elles servent aux enquêtes.",
      "**Parlez-en à quelqu'un aujourd'hui** — un proche, ou nous. L'isolement est l'outil principal de l'escroc : c'est pour ça qu'il vous demande de garder le secret.",
    ],
    droit:
      "Si vous avez déjà envoyé de l'argent : portez plainte, même si vous avez honte, même si la somme vous paraît petite. " +
      "Ces plaintes sont regroupées et font tomber des réseaux entiers. Le " + LIENS.victimes + " écoute aussi, sans jamais juger.",
    chips: [
      "J'ai déjà envoyé de l'argent",
      "Il dit qu'il va venir me voir",
      "Et si c'était vrai quand même ?",
    ],
  },

  // 10 ────────────────────────────────────────
  {
    id: 'chantage-webcam',
    label: 'Chantage à la webcam',
    money: false,
    escalate: true,
    match: [
      /(webcam|cam[ée]ra|vid[ée]o).{0,50}(intime|nu|chantage|publier|diffuser|contacts)/i,
      /(chantage|sextorsion|ma[îi]tre chanteur)/i,
      /menace.{0,40}(publier|diffuser|envoyer).{0,40}(photo|vid[ée]o|contacts|famille)/i,
      /(il|elle) (dit|pr[ée]tend) (avoir|qu'il a).{0,40}(vid[ée]o|photo|images)/i,
    ],
    calme:
      "Ne payez pas, et ne répondez pas. Dans l'immense majorité des cas, la personne n'a rien du tout — " +
      "et quand elle a quelque chose, payer n'arrête jamais les demandes, ça les multiplie.",
    gestes: [
      "**Ne payez rien, ne répondez rien, ne négociez pas.** Le silence est ce qui met fin à la manœuvre le plus vite.",
      "**Bloquez et signalez le compte** sur la plateforme concernée (chaque réseau a un bouton « signaler »).",
      "**Conservez les captures d'écran**, le pseudo, l'adresse du portefeuille bitcoin s'il y en a un. Sans rien effacer.",
      "**Portez plainte.** Le chantage est un délit, et dans cette affaire vous êtes la victime — jamais l'inverse.",
    ],
    droit:
      "Rien de ce qui vous arrive n'est honteux : ces messages sont envoyés en masse à des milliers de personnes chaque jour, " +
      "au hasard. Le " + LIENS.victimes + " et " + LIENS.cyber + " accompagnent ces situations tous les jours, sans jugement.",
    chips: [
      "Il dit qu'il a ma liste de contacts",
      "J'ai déjà payé",
      "Est-ce qu'il peut vraiment publier ?",
    ],
  },

  // 11 ────────────────────────────────────────
  {
    id: 'faux-support',
    label: 'Faux support technique / prise de contrôle à distance',
    money: true,
    escalate: true,
    match: [
      /(anydesk|teamviewer|ultraviewer|prise (de contr[ôo]le|en main)).{0,40}/i,
      /(microsoft|apple|windows|orange|free|sfr).{0,40}(m'a appel|technicien|support).{0,30}(virus|probl[èe]me|infect)/i,
      /(faux )?(technicien|d[ée]panneur|support technique).{0,40}(ordinateur|[ée]cran|virus)/i,
      // « le technicien de microsoft », « le support Orange » — marque après.
      /(technicien|support technique|d[ée]panneur).{0,25}(microsoft|apple|windows|orange|free|sfr|informatique)/i,
      /(message|fen[êe]tre|page).{0,30}(bloqu[ée]|alerte).{0,30}(ordinateur|num[ée]ro [àa] appeler)/i,
      /il (a pris|contr[ôo]le) (la main|mon ordinateur)/i,
    ],
    calme:
      "Si la prise en main est encore active : **coupez le WiFi ou débranchez le câble internet maintenant.** " +
      "L'accès s'arrête à la seconde, et vous ne cassez rien en faisant ça.",
    gestes: [
      "**Coupez la connexion internet, puis éteignez l'ordinateur.** Dans cet ordre.",
      "**Ne rappelez jamais le numéro affiché à l'écran** : c'est celui de l'escroc. Microsoft, Apple, Orange ou Free n'appellent jamais personne pour un virus.",
      "**Si vous avez payé ou donné votre carte** : bloquez-la immédiatement au " + LIENS.oppositionCarte + ", puis signalez sur " + LIENS.perceval + ".",
      "**Désinstallez le logiciel de prise en main** (AnyDesk, TeamViewer, UltraViewer) et changez les mots de passe utilisés pendant la séance — depuis un autre appareil, téléphone ou tablette.",
    ],
    droit:
      "Un « technicien » qui vous fait acheter des cartes cadeaux, faire un virement, ou installer un logiciel " +
      "pour « corriger une erreur de remboursement » est un escroc, sans exception. Le signalement se fait sur " + LIENS.cyber + ".",
    chips: [
      "Ils ont encore accès à mon ordinateur",
      "J'ai payé avec ma carte",
      "Comment je désinstalle le logiciel ?",
    ],
  },

  // 12 ────────────────────────────────────────
  {
    id: 'analyse-message',
    label: 'Est-ce une arnaque ? (méthode de vérification)',
    money: false,
    escalate: false,
    // Ne se déclenche que si le client POSE la question sans avoir collé le
    // message. Dès qu'il colle un contenu (lien, texte long), on laisse
    // l'analyseur et l'IA faire leur travail : une réponse figée serait
    // incapable de juger un message qu'elle n'a pas lu.
    guard: (t) => t.length < 160 && !/https?:\/\/|www\.|\b[\w-]+\.(fr|com|net|org|info|xyz)\b/i.test(t),
    match: [
      /(est-ce|c'est|c est|ce serait).{0,20}(une )?arnaque/i,
      /arnaque \?/i,
      /(ce|un|le|mon) (message|sms|mail|e-?mail|courriel).{0,45}(vrai|faux|arnaque|suspect|bizarre|louche|fiable)/i,
      /(savoir|comment).{0,20}(s'il est|si c'est|si ce).{0,15}(vrai|fiable|une arnaque|authentique)/i,
      /j'ai re[çc]u un (sms|mail|message|e-?mail).{0,45}(bizarre|suspect|louche|[ée]trange|pas normal)/i,
    ],
    calme:
      "Envoyez-le moi : copiez le message et collez-le ici, ou décrivez-le moi en deux mots. " +
      "Je vous dis en quelques secondes si c'est une arnaque. En attendant, voici comment le lire vous-même.",
    gestes: [
      "**Le nom du site dans le lien.** Le vrai nom se lit juste avant le « .fr » ou le « .com ». « laposte-colis.net » n'est pas La Poste, « ameli-remboursement.info » n'est pas l'Assurance maladie.",
      "**Une somme à payer, même minuscule.** 1,49 € de frais de douane, 2 € de mise à jour : c'est le grand classique, et c'est votre numéro de carte qui les intéresse.",
      "**L'urgence.** « sous 48 h », « dernier avis », « votre compte sera fermé » : c'est fait pour vous empêcher de réfléchir.",
      "**Le canal.** Votre banque, les impôts et l'Assurance maladie ne demandent jamais de coordonnées bancaires par SMS ni par mail.",
    ],
    droit:
      "La règle qui vous protège dans tous les cas, même sans savoir lire un lien : n'utilisez jamais le lien du message. " +
      "Ouvrez vous-même l'application, ou tapez l'adresse du site à la main. Ainsi, vous ne pouvez pas vous tromper. " +
      "Les SMS douteux se transfèrent au " + LIENS.sms + " (gratuit).",
    chips: [
      "Je vous colle le message",
      "J'ai déjà cliqué sur le lien",
      "C'est un appel, pas un message",
    ],
  },

];

// ─────────────────────────────────────────────
// Aiguillage
// ─────────────────────────────────────────────

/**
 * Normalise la saisie avant comparaison.
 * Indispensable : un iPhone remplace automatiquement l'apostrophe droite (')
 * par une apostrophe typographique (’). Sans ça, « j’ai donné ma carte »
 * tapé sur mobile — donc la majorité de nos clients — ne déclencherait
 * aucune fiche.
 */
function normalise(text) {
  return String(text)
    .replace(/[‘’ʼ`´]/g, "'")   // apostrophes typographiques
    .replace(/[  ]/g, ' ')            // espaces insécables
    .replace(/\s+/g, ' ')
    .trim();
}

/** Renvoie la fiche correspondante, ou null si l'IA doit prendre la main. */
function matchPlaybook(text) {
  if (!text || typeof text !== 'string') return null;
  const t = normalise(text);
  if (t.length < 6) return null;
  for (const pb of PLAYBOOKS) {
    if (!pb.match.some((re) => re.test(t))) continue;
    if (typeof pb.guard === 'function' && !pb.guard(t)) continue;
    return pb;
  }
  return null;
}

/** Le rappel humain est-il proposable maintenant ? (heure de Paris) */
function callbackOpen(now = new Date()) {
  // fr-FR renvoie « 12 h » (et non « 12 ») : on lit la partie horaire
  // plutôt que la chaîne formatée, sinon Number() donne NaN.
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Paris',
  }).formatToParts(now);
  const h = Number((parts.find((p) => p.type === 'hour') || {}).value);
  if (!Number.isFinite(h)) return true;   // en cas de doute, on reste joignable
  return h >= CALLBACK_START && h < CALLBACK_END;
}

/** Assemble la réponse finale : on rassure, les gestes, le relais humain. */
function buildPlaybookReply(pb, now = new Date()) {
  const open = callbackOpen(now);
  // `escalate` prime ; `money` sert de repli pour les fiches du premier lot.
  const escalate = pb.escalate !== undefined ? pb.escalate : pb.money === true;

  // Le geste porte déjà son propre gras : le numéro reste en texte simple.
  const gestes = pb.gestes.map((g, i) => `${i + 1}. ${g}`).join('\n\n');

  // Certaines fiches sont elles-mêmes le relais : pas de invitation circulaire.
  if (pb.norelais) {
    return {
      reply: [pb.calme, gestes, pb.droit].join('\n\n'),
      playbook: pb.id,
      escalate: false,
      callback: open ? 'immediat' : 'differe',
      chips: pb.chips,
    };
  }

  let relais;
  if (escalate && open) {
    relais = "Voulez-vous qu'un conseiller vous appelle **dans les 5 minutes** ? Répondez simplement « appelez-moi ».";
  } else if (escalate) {
    relais = `Nos conseillers répondent de ${CALLBACK_START} h à ${CALLBACK_END} h. ` +
      "Faites les gestes ci-dessus maintenant — ils ne peuvent pas attendre — et un conseiller vous rappelle dès l'ouverture. " +
      "Répondez « rappelez-moi » pour être placé en tête de liste.";
  } else if (open) {
    // Rien d'urgent : on propose, on ne dramatise pas.
    relais = "Si vous préférez qu'on le fasse ensemble, répondez « appelez-moi » et un conseiller vous guide pas à pas.";
  } else {
    relais = `Si vous voulez qu'on le fasse ensemble, répondez « rappelez-moi » : un conseiller vous appelle dès ${CALLBACK_START} h.`;
  }

  const reply = [pb.calme, gestes, pb.droit, relais].join('\n\n');

  return {
    reply,
    playbook: pb.id,
    escalate,
    callback: open ? 'immediat' : 'differe',
    chips: pb.chips,
  };
}

module.exports = { PLAYBOOKS, matchPlaybook, buildPlaybookReply, callbackOpen, CALLBACK_START, CALLBACK_END };
