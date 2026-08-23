// ════════════════════════════════════════════
// DESPY — Détection des vagues d'arnaques chez nos propres membres
//
// C'est le seul étage de la chaîne qui puisse aller PLUS VITE que les médias :
// nos membres reçoivent le SMS le matin, la télévision en parle trois semaines
// plus tard. Encore faut-il que le détecteur fonctionne. L'ancienne version
// (detectInternalWaves, dans national-alerts.js) avait trois défauts, et les
// trois se manifestaient par un silence — donc par rien du tout :
//
//   1. Elle comptait des OCCURRENCES, pas des PERSONNES. Elle ne lisait même
//      pas la colonne `email`. Un seul membre inquiet qui colle trois fois le
//      même SMS déclenchait une notification à tout le monde ; pire, un seul
//      message contenant trois fois le même lien suffisait.
//   2. Toutes les vagues portaient la même URL (`despy.fr/#analyseur`), et le
//      robot dédoublonne par URL. La toute première vague détectée était donc
//      enregistrée, et TOUTES les suivantes rejetées en silence, à jamais.
//   3. Elle ne lisait que des noms de domaine, alors que l'arnaque qui vise
//      nos abonnés arrive par SMS avec un numéro à rappeler. Le commentaire
//      annonçait « domaines/numéros » ; le code ne voyait que les domaines.
//
// Le seuil est désormais de DEUX PERSONNES DISTINCTES. C'est à la fois plus
// sensible qu'avant (où il fallait trois collages, souvent du même membre) et
// beaucoup plus sûr : que deux membres sans lien collent le même domaine ou
// le même numéro à trois jours d'intervalle n'arrive pas par hasard.
//
// L'adresse email ne sert qu'à compter des personnes. Elle n'est ni stockée
// ici, ni publiée, ni transmise.
// ════════════════════════════════════════════

const FENETRE_HEURES = 72;
const SEUIL_PERSONNES = 2;

// Une même vague ne se republie pas avant deux semaines : la campagne dure
// souvent plusieurs jours, et re-notifier tout le monde chaque matin pour le
// même numéro est le meilleur moyen qu'on cesse de nous lire.
const REPUBLICATION_JOURS = 14;
const MAX_PAR_PASSAGE = 2;

const ETIQUETTE = 'Despy Community';

// Les domaines qu'un message frauduleux cite légitimement : l'escroc se fait
// passer pour eux et mentionne leur vrai nom. Comparaison exacte ou en
// sous-domaine — « laposte-colis.fr » n'est PAS couvert par « laposte.fr »,
// et c'est exactement le genre d'adresse qu'on veut attraper.
const DOMAINES_LEGITIMES = [
  'despy.fr', 'gouv.fr', 'service-public.fr', 'impots.gouv.fr', 'ameli.fr',
  'caf.fr', 'urssaf.fr', 'msa.fr', 'antai.gouv.fr', 'laposte.fr',
  'laposte.net', 'colissimo.fr', 'chronopost.fr', 'mondialrelay.fr',
  'ups.com', 'dhl.com', 'fedex.com', 'amazon.fr', 'amazon.com',
  'leboncoin.fr', 'fnac.com', 'cdiscount.com', 'sncf.com',
  'sncf-connect.com', 'ratp.fr', 'edf.fr', 'engie.fr', 'orange.fr',
  'sfr.fr', 'bouyguestelecom.fr', 'free.fr', 'bnpparibas.net',
  'creditmutuel.fr', 'lcl.fr', 'labanquepostale.fr', 'societegenerale.fr',
  'caisse-epargne.fr', 'creditagricole.fr', 'paypal.com', 'google.com',
  'apple.com', 'microsoft.com', 'facebook.com', 'whatsapp.com',
  'doctolib.fr', 'cybermalveillance.gouv.fr', 'cnil.fr'
];

// Numéros publics qu'on ne doit jamais désigner comme frauduleux, même si un
// message d'arnaque les cite pour se donner l'air officiel.
const NUMEROS_LEGITIMES = [
  '3646', '3639', '33700', '17', '15', '18', '112', '114', '3977', '3919'
];

// On exige une extension plausible : sans ça, « M.Dupont » ou « etc.la »
// passent pour des domaines, et on finit par désigner nommément quelqu'un
// dans une notification envoyée à tous.
const EXTENSIONS = [
  'fr', 'com', 'net', 'org', 'info', 'eu', 'be', 'ch', 'ca', 'io', 'co',
  'me', 'biz', 'pro', 'app', 'dev', 'shop', 'store', 'site', 'online',
  'website', 'space', 'live', 'life', 'world', 'today', 'one', 'link',
  'click', 'page', 'top', 'xyz', 'icu', 'vip', 'buzz', 'fun', 'cc', 'tk',
  'ml', 'ga', 'cf', 'gq', 'ru', 'cn', 'su', 'sbs', 'cyou', 'bond', 'cfd',
  'rest', 'lol', 'wiki', 'art', 'zip', 'mov'
];

function estDomaineLegitime(dom) {
  return DOMAINES_LEGITIMES.some(l => dom === l || dom.endsWith('.' + l));
}

// « +33 (0)6 12 34 56 78 », « 06.12.34.56.78 », « 0033612345678 » → « 0612345678 »
function normaliserNumero(brut) {
  let d = String(brut || '').replace(/\D/g, '');
  if (d.startsWith('0033')) d = d.slice(4);
  else if (d.startsWith('33') && d.length >= 11) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  else return null;
  if (d.startsWith('0')) d = d.slice(1);        // le « (0) » de « +33 (0)6 »
  if (!/^[1-9]\d{8}$/.test(d)) return null;
  return '0' + d;
}

// Lu à voix haute par quelqu'un qui vérifie son journal d'appels.
function formaterNumero(n) {
  return n.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

// Les signaux d'UN message, dédoublonnés : un SMS qui répète trois fois le
// même lien ne vaut qu'une fois. C'est précisément ce qui manquait avant.
function extraireSignaux(contenu) {
  const txt = String(contenu || '');
  const vus = new Set();
  const out = [];
  const ajouter = (type, valeur) => {
    const cle = type + ':' + valeur;
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push({ type, valeur });
  };

  const domaines = txt.match(/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,6}\b/gi) || [];
  for (const brut of domaines) {
    const dom = brut.toLowerCase().replace(/\.+$/, '');
    const ext = dom.split('.').pop();
    if (EXTENSIONS.indexOf(ext) === -1) continue;
    if (estDomaineLegitime(dom)) continue;
    ajouter('domaine', dom);
  }

  const numeros = txt.match(/(?:\+33|0033|0)[\s.\-]*(?:\(0\))?[\s.\-]*\d(?:[\s.\-]*\d){7,9}/g) || [];
  for (const brut of numeros) {
    const n = normaliserNumero(brut);
    if (!n) continue;
    if (NUMEROS_LEGITIMES.indexOf(n) !== -1) continue;
    ajouter('numero', n);
  }

  return out;
}

// Compte des PERSONNES, jamais des lignes. Une adresse manquante retombe sur
// l'IP, et à défaut sur l'indice de la ligne — de sorte qu'une ligne anonyme
// ne puisse jamais valoir pour deux.
function compterVagues(lignes) {
  const personnes = {};
  (lignes || []).forEach((l, i) => {
    const qui = (l.email || '').toLowerCase() || ('ip:' + (l.ip || '')) || ('ligne:' + i);
    for (const s of extraireSignaux(l.content)) {
      const cle = s.type + ':' + s.valeur;
      if (!personnes[cle]) personnes[cle] = { type: s.type, valeur: s.valeur, qui: new Set() };
      personnes[cle].qui.add(qui);
    }
  });

  return Object.keys(personnes)
    .map(k => ({ type: personnes[k].type, valeur: personnes[k].valeur,
                 personnes: personnes[k].qui.size }))
    .filter(v => v.personnes >= SEUIL_PERSONNES)
    .sort((a, b) => b.personnes - a.personnes || a.valeur.localeCompare(b.valeur));
}

function texteVague(v) {
  if (v.type === 'numero') {
    return {
      title: 'Vague d’arnaque détectée : le numéro ' + formaterNumero(v.valeur),
      body: v.personnes + ' membres ont reçu ces trois derniers jours un message '
        + 'frauduleux mentionnant ce numéro. Ne le rappelez pas, même s’il se '
        + 'présente comme votre banque ou un service public.'
    };
  }
  return {
    title: 'Vague d’arnaque détectée : le site ' + v.valeur,
    body: v.personnes + ' membres ont reçu ces trois derniers jours un message '
      + 'frauduleux contenant cette adresse. Ne cliquez sur aucun lien qui la '
      + 'contient, même s’il semble venir d’un organisme connu.'
  };
}

// Le dédoublonnage se fait sur le TITRE, comme pour le calendrier : l'URL est
// la même pour toutes les vagues, et dédoublonner par URL les aurait réduites
// à une seule dans toute la vie du service.
async function detecterVagues(supabase, maintenant) {
  const now = maintenant || new Date();
  const depuis = new Date(now.getTime() - FENETRE_HEURES * 3600 * 1000).toISOString();

  const { data: lignes, error } = await supabase
    .from('analyses_history')
    .select('email, ip, content')
    .eq('verdict', 'scam')
    .gte('created_at', depuis)
    .limit(500);

  if (error) {
    console.error('[vagues] lecture impossible :', error.message);
    return [];
  }
  if (!lignes || lignes.length < SEUIL_PERSONNES) return [];

  const candidates = compterVagues(lignes);
  if (!candidates.length) return [];

  const limite = new Date(now.getTime() - REPUBLICATION_JOURS * 86400000).toISOString();
  const retenues = [];
  for (const v of candidates) {
    if (retenues.length >= MAX_PAR_PASSAGE) break;
    const t = texteVague(v);
    const { data: deja, error: e2 } = await supabase
      .from('national_alerts')
      .select('id')
      .eq('title', t.title)
      .gte('created_at', limite)
      .limit(1);
    if (e2) {
      console.error('[vagues] base indisponible, publication reportée :', e2.message);
      return [];
    }
    if (deja && deja.length) continue;
    retenues.push({
      title: t.title,
      body: t.body,
      // L'ancienne version pointait vers « despy.fr/#analyseur », une ancre qui
      // n'existe dans aucune page : le membre qui cliquait sur la notification
      // atterrissait en haut du site commercial. Ici il arrive sur la page qui
      // contient justement l'alerte qu'il vient de recevoir (le paramètre est
      // conservé par la redirection 301 de /app, et ignoré sans dommage si la
      // session n'est pas ouverte).
      url: 'https://despy.fr/app?tool=alertes',
      source: ETIQUETTE,
      published: new Date().toISOString()
    });
  }
  return retenues;
}

module.exports = {
  FENETRE_HEURES, SEUIL_PERSONNES, REPUBLICATION_JOURS, MAX_PAR_PASSAGE,
  ETIQUETTE, DOMAINES_LEGITIMES, NUMEROS_LEGITIMES,
  normaliserNumero, formaterNumero, estDomaineLegitime,
  extraireSignaux, compterVagues, texteVague, detecterVagues
};
