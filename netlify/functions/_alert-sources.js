// ════════════════════════════════════════════
// DESPY — Les sources d'alertes, et le tri de ce qui mérite d'être dit
//
// Pourquoi ce fichier existe : deux robots (national-alerts, cyber-alerts)
// allaient chacun chercher leurs flux avec leur propre parseur et leur propre
// liste de mots-clés. Les deux ne ramenaient RIEN, pour trois raisons :
//
//   1. Le flux de Cybermalveillance était mort (404 depuis un moment) — et
//      l'erreur était avalée en silence, donc personne ne l'a jamais su.
//   2. La seule source qui répondait, le CERT-FR de l'ANSSI, ne publie que des
//      bulletins de failles logicielles pour administrateurs système
//      (« Multiples vulnérabilités dans Zabbix »). Ça ne concerne pas nos
//      abonnés, et aucun mot-clé grand public n'y apparaît jamais.
//   3. Le parseur ne lisait que le RSS (<item>). Or les vrais flux utiles de
//      Cybermalveillance sont en Atom (<entry>) : ils étaient illisibles.
//
// D'où ce module unique : les bonnes sources, un parseur qui lit les deux
// formats, et UN SEUL endroit où se décide ce qui parle à une personne de
// 70 ans. Avant, ce tri existait en trois exemplaires divergents.
// ════════════════════════════════════════════

// ── Les sources ──────────────────────────────────────────────────────────
// Retenues parce qu'elles parlent de l'événement et de ses victimes, pas du
// logiciel. La CNIL est celle qui attrape les piratages d'institutions
// (impôts, opérateurs, mutuelles) — c'est-à-dire ce qui inquiète vraiment.
const SOURCES = [
  {
    nom: 'CNIL',
    url: 'https://www.cnil.fr/fr/rss.xml',
    format: 'rss',
    etiquette: 'CNIL · officiel'
  },
  {
    nom: 'Cybermalveillance',
    url: 'https://www.cybermalveillance.gouv.fr/feed/atom-flux-actualites',
    format: 'atom',
    etiquette: 'Cybermalveillance.gouv.fr'
  },
  // NB : le flux « atom-flux-alertes » du même site a été écarté après essai.
  // Il ne contient que trois pages d'accueil permanentes (« AlerteCyber »,
  // « Bulletin de vigilance ») sans résumé : des titres qui n'apprennent rien
  // à personne. Mieux vaut trois alertes utiles que six dont trois sont creuses.
  //
  // Gardée par acquit de conscience : le CERT-FR publie de temps en temps une
  // vraie alerte grand public au milieu des avis techniques. Le filtre s'en
  // charge — sur 40 bulletins récents, zéro n'est passé, et c'est normal.
  {
    nom: 'ANSSI',
    url: 'https://www.cert.ssi.gouv.fr/feed/',
    format: 'rss',
    etiquette: 'ANSSI · officiel'
  }
];

// ── Décodage ─────────────────────────────────────────────────────────────
// Les flux gouvernementaux sont truffés d'entités : « Remboursement
// d&rsquo;imp&ocirc;t ». Affiché tel quel dans l'appli, ça fait amateur.
const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  hellip: '…', ndash: '–', mdash: '—', laquo: '«',
  raquo: '»', eacute: 'é', egrave: 'è', ecirc: 'ê',
  agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô',
  ugrave: 'ù', ucirc: 'û', icirc: 'î', iuml: 'ï',
  euro: '€', deg: '°', middot: '·'
};

function decoder(txt) {
  if (!txt) return '';
  return String(txt)
    .replace(/<[^>]+>/g, ' ')                       // balises HTML du résumé
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, nom) => {
      const c = ENTITES[nom] !== undefined ? ENTITES[nom] : ENTITES[nom.toLowerCase()];
      return c !== undefined ? c : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Sans accents et en minuscules : « hameçonnage » doit matcher si la source
// écrit « hameconnage », et inversement.
function aplatir(txt) {
  return String(txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');   // marques diacritiques laissées par NFD
}

// ── Parseurs ─────────────────────────────────────────────────────────────
function baliseTexte(bloc, tag) {
  const m = bloc.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  if (!m) return '';
  return decoder(m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, ''));
}

function parserRss(xml) {
  const out = [];
  const blocs = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const bloc of blocs) {
    const titre = baliseTexte(bloc, 'title');
    if (!titre) continue;
    out.push({
      titre,
      resume: baliseTexte(bloc, 'description'),
      url: baliseTexte(bloc, 'link'),
      date: baliseTexte(bloc, 'pubDate') || baliseTexte(bloc, 'dc:date')
    });
  }
  return out;
}

function parserAtom(xml) {
  const out = [];
  const blocs = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const bloc of blocs) {
    const titre = baliseTexte(bloc, 'title');
    if (!titre) continue;
    // En Atom l'URL est un ATTRIBUT (<link href="…"/>), pas un contenu.
    // C'est précisément ce que l'ancien parseur ne savait pas faire.
    const lien = bloc.match(/<link[^>]*href=["']([^"']+)["']/i);
    out.push({
      titre,
      resume: baliseTexte(bloc, 'summary') || baliseTexte(bloc, 'content'),
      url: lien ? decoder(lien[1]) : baliseTexte(bloc, 'id'),
      date: baliseTexte(bloc, 'published') || baliseTexte(bloc, 'updated')
    });
  }
  return out;
}

// ── Le tri ───────────────────────────────────────────────────────────────
// Deux listes plutôt qu'une. Une liste d'inclusion seule laissait passer
// « AlerteCyber : failles critiques dans SharePoint » (le mot « sécurité »
// suffisait) ; une liste d'exclusion seule laissait passer les nominations et
// les webinaires. Il faut les deux : parler du sujet ET s'adresser au public.

// Ce dont un particulier est victime.
const PERTINENT = [
  'hameconnage', 'phishing', 'arnaque', 'escroquerie', 'fraude', 'escroc',
  'faux sms', 'smishing', 'vishing', 'faux courriel', 'faux mail', 'faux site',
  'usurpation', 'piratage', 'pirate', 'compte pirate',
  'fuite de donnees', 'violation de donnees', 'vol de donnees', 'donnees volees',
  'rancongiciel', 'ransomware', 'logiciel espion', 'demarchage',
  'faux conseiller', 'faux support', 'faux technicien', 'faux ordre de virement',
  'chantage', 'sextorsion', 'harcelement',
  // Les marques et institutions dont on usurpe l'identité auprès des seniors.
  'impot', 'ameli', 'cpam', 'assurance maladie', 'caf', 'urssaf', 'carsat',
  'retraite', 'mutuelle', 'banque', 'carte bancaire', 'compte bancaire',
  'colis', 'livraison', 'chronopost', 'la poste', 'amende', 'permis de conduire',
  'compte personnel de formation', 'cpf', 'anah', 'renovation',
  'pieges', 'piege'
];

// Ce qui ne s'adresse pas à lui : le monde professionnel et institutionnel,
// et les publications rétrospectives (un bilan annuel n'est pas une alerte).
const HORS_SUJET = [
  'vulnerabilite', 'faille de securite', 'failles de securite', 'correctif',
  'cve-', 'zero-day', 'patch', 'exploitation active', 'bulletin d\'actualite',
  'multiples vulnerabilites', 'mise a jour de securite',
  'tpe-pme', 'tpe/pme', 'professionnel', 'entreprises', 'collectivite',
  'administrateur', 'dpo', 'delegue a la protection', 'responsable de traitement',
  'webinaire', 'colloque', 'conference', 'appel a candidature', 'recrutement',
  'nomination', 'nommes', 'college de la cnil', 'deliberation', 'referentiel',
  'consultation publique', 'rapport annuel', 'rapport d\'activite', 'bilan',
  'lettre d\'information', 'campagne de sensibilisation', 'cybermois',
  'kit de communication', 'mallette', 'label', 'partenariat', 'convention',
  'sanction', 'mise en demeure', 'amende administrative', 'clauses types',
  'sous-traitant', 'certification', 'code de conduite',
  // Titres de bilans : « L'hameçonnage en 2025 », « Le piratage ... en 2024 ».
  ' en 2023', ' en 2024', ' en 2025'
];

// Une alerte est retenue si elle parle d'un danger que vit un particulier ET
// qu'elle n'est pas destinée aux professionnels.
//
// Le mot de danger doit se trouver dans le TITRE. C'est ce qui distingue une
// alerte d'un article qui mentionne le sujet en passant : « Le refus de crédit
// en questions » contenait « banque » dans son corps et passait le filtre,
// alors qu'il ne parle d'aucune arnaque. Le résumé, lui, ne sert qu'à écarter.
function pertinentPourSenior(titre, resume) {
  const t = aplatir(titre);
  const tout = aplatir((titre || '') + ' ' + (resume || ''));
  if (!t.trim()) return false;
  if (HORS_SUJET.some(k => tout.indexOf(k) !== -1)) return false;
  return PERTINENT.some(k => t.indexOf(k) !== -1);
}

// ── Récupération ─────────────────────────────────────────────────────────
async function lireSource(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Despy-Alertes/2.0 (+https://despy.fr)' },
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) {
      // Bruyant volontairement : c'est le silence de l'ancienne version qui a
      // laissé une source morte en place sans que personne ne s'en aperçoive.
      console.error(`[alertes] source INJOIGNABLE ${source.nom} (${res.status}) ${source.url}`);
      return [];
    }
    const xml = await res.text();
    const bruts = source.format === 'atom' ? parserAtom(xml) : parserRss(xml);
    if (!bruts.length) {
      console.error(`[alertes] source VIDE ou format inattendu : ${source.nom} ${source.url}`);
      return [];
    }
    return bruts.map(b => ({
      title: b.titre,
      body: b.resume ? b.resume.slice(0, 400) : '',
      url: b.url,
      source: source.etiquette,
      published: dateIso(b.date)
    }));
  } catch (e) {
    console.error(`[alertes] erreur ${source.nom}:`, e && e.message);
    return [];
  }
}

function dateIso(txt) {
  if (!txt) return null;
  // « 2026-08-18 13:06:32 » (Cybermalveillance) n'est pas une date ISO valide
  // pour Date() sur tous les moteurs : on la normalise.
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(txt) ? txt.replace(' ', 'T') : txt);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Toutes les sources, en parallèle, dédoublonnées par URL, triées du plus
// récent au plus ancien, et filtrées pour notre public.
// `maxJours` évite d'annoncer comme « en ce moment » un article de mars.
async function collecterAlertes(maxJours) {
  const limite = maxJours ? Date.now() - maxJours * 24 * 3600 * 1000 : null;
  const paquets = await Promise.all(SOURCES.map(lireSource));

  const vues = new Set();
  const retenues = [];
  for (const item of [].concat.apply([], paquets)) {
    if (!item.url || vues.has(item.url)) continue;
    if (!pertinentPourSenior(item.title, item.body)) continue;
    if (limite && item.published && new Date(item.published).getTime() < limite) continue;
    vues.add(item.url);
    retenues.push(item);
  }

  retenues.sort((a, b) =>
    new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime());
  return retenues;
}

// ── Contrôle de santé ────────────────────────────────────────────────────
// Pour la sentinelle hebdomadaire. Compter les alertes retenues ne suffit
// pas : une source peut répondre 200 et ne plus rien contenir de lisible
// (adresse conservée, format changé). Vu de loin, ça ressemble exactement à
// une semaine calme — c'est cette confusion qui a duré des mois.
//
// On rapporte donc trois choses par source : le code HTTP, le nombre
// d'entrées que le parseur arrive à lire, et le nombre qui passe le tri.
async function diagnostiquer() {
  return Promise.all(SOURCES.map(async (source) => {
    const etat = { nom: source.nom, url: source.url, http: 0,
                   entrees: 0, retenues: 0, erreur: null };
    try {
      const res = await fetch(source.url, {
        headers: { 'User-Agent': 'Despy-Alertes/2.0 (+https://despy.fr)' },
        signal: AbortSignal.timeout(9000)
      });
      etat.http = res.status;
      if (!res.ok) return etat;
      const xml = await res.text();
      const bruts = source.format === 'atom' ? parserAtom(xml) : parserRss(xml);
      etat.entrees = bruts.length;
      etat.retenues = bruts.filter(b => pertinentPourSenior(b.titre, b.resume)).length;
    } catch (e) {
      etat.erreur = (e && e.message) || 'erreur inconnue';
    }
    return etat;
  }));
}

module.exports = {
  SOURCES,
  collecterAlertes,
  diagnostiquer,
  pertinentPourSenior,
  parserRss,
  parserAtom,
  decoder,
  aplatir
};
