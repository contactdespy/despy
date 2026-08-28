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
// `confiance` décide de ce qu'on a le droit de faire du résultat :
//   'officiel' → publiable tel quel, comme aujourd'hui ;
//   'presse'   → jamais publié sans relecture humaine (voir plus bas).
const SOURCES = [
  {
    nom: 'CNIL',
    url: 'https://www.cnil.fr/fr/rss.xml',
    format: 'rss',
    etiquette: 'CNIL · officiel',
    confiance: 'officiel'
  },
  {
    nom: 'Cybermalveillance',
    url: 'https://www.cybermalveillance.gouv.fr/feed/atom-flux-actualites',
    format: 'atom',
    etiquette: 'Cybermalveillance.gouv.fr',
    confiance: 'officiel'
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
    etiquette: 'ANSSI · officiel',
    confiance: 'officiel'
  },

  // ── La presse ──────────────────────────────────────────────────────────
  // Pourquoi il en fallait une : rejoué sur les flux officiels le 28 août
  // 2026, ce module retenait QUATRE alertes, dont la plus récente datait du
  // 18 août et la plus ancienne du 3 juin. Les institutions publient bien,
  // mais lentement — quelques articles grand public par trimestre.
  //
  // Le jour où la gendarmerie a alerté sur l'arnaque à la carte SIM, Despy ne
  // pouvait pas le savoir : « SIM » n'apparaissait pas une seule fois dans les
  // trois flux, et gendarmerie.interieur.gouv.fr répond 403 à tout robot,
  // quelle que soit l'adresse essayée. Impossible de la lire directement ;
  // en revanche la presse la reprend dans l'heure.
  //
  // Google Actualités est un vrai flux RSS, sans clé ni compte, interrogeable
  // par mots-clés. `when:Nd` borne la fenêtre côté Google : on ne rapatrie pas
  // six mois d'archives pour n'en garder que la semaine.
  // Le second groupe de parenthèses est ce qui fait passer la requête de 100 à
  // 47 résultats, en remontant ce qui touche un particulier (SMS, banque,
  // téléphone) plutôt que l'escroquerie d'entreprise ou la polémique politique.
  {
    nom: 'Presse nationale',
    url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(
           '(arnaque OR escroquerie OR hameçonnage) '
         + '(senior OR "personne âgée" OR retraité OR banque OR SMS) when:7d')
       + '&hl=fr&gl=FR&ceid=FR:fr',
    format: 'rss',
    etiquette: 'presse',
    confiance: 'presse'
  },
  // Celle-ci est la plus précieuse et n'a pas d'équivalent officiel. Une
  // alerte nationale de la CNIL, un membre la verra passer partout ; une
  // arnaque au faux coursier signalée dans SON département, personne d'autre
  // ne la lui dira. La fenêtre est plus large parce que le débit est plus
  // faible : 17 articles sur 30 jours, contre 100 sur 7 pour le national.
  {
    nom: 'Presse locale',
    url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(
           '(arnaque OR escroquerie) '
         + '(Bas-Rhin OR Strasbourg OR Alsace OR Haguenau OR Sélestat) when:30d')
       + '&hl=fr&gl=FR&ceid=FR:fr',
    format: 'rss',
    etiquette: 'presse locale',
    confiance: 'presse',
    // Google honore mal la contrainte géographique : cette requête ramenait
    // « À Villejuif, un retraité victime… », « Plans Thaïlande » et « PSG :
    // Ferran Torres, attention à l'arnaque », tous étiquetés « presse locale ».
    // On réimpose donc nous-mêmes le territoire. Les communes citées sont les
    // plus peuplées du Bas-Rhin, plus les deux voisines que la presse associe
    // toujours à la région.
    exige: ['bas-rhin', 'strasbourg', 'alsace', 'alsacien', 'haguenau',
            'selestat', 'saverne', 'schiltigheim', 'illkirch', 'bischheim',
            'obernai', 'molsheim', 'wissembourg', 'colmar', 'mulhouse']
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

function entites(txt) {
  return txt
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, nom) => {
      const c = ENTITES[nom] !== undefined ? ENTITES[nom] : ENTITES[nom.toLowerCase()];
      return c !== undefined ? c : m;
    });
}

// DEUX passes de nettoyage, et l'ordre compte.
//
// Google Actualités n'envoie pas du texte mais du HTML ÉCHAPPÉ :
//   &lt;a href="https://news.google.com/rss/articles/CBMi0AFBVV95cUxQYXhwMEd…"&gt;
// Une seule passe « enlever les balises puis décoder les entités » ne voyait
// aucune balise (il n'y a pas de « < » littéral), décodait ensuite le &lt; …
// et laissait le lien entier — base64 compris — dans le résumé.
//
// Ce n'était pas cosmétique : le tri cherche des mots-clés dans le résumé, et
// un base64 de 300 caractères contient par hasard « sport », « psg », « uni »…
// L'article du SIM swapping — l'exemple même qui a lancé ce chantier — était
// écarté parce que son identifiant Google contenait une suite de lettres
// interdite. Le filtre tirait à pile ou face.
//
// On décode donc, PUIS on retire les balises ainsi révélées.
function decoder(txt) {
  if (!txt) return '';
  return entites(String(txt).replace(/<[^>]+>/g, ' '))   // balises littérales
    .replace(/<[^>]+>/g, ' ')                            // balises révélées
    .replace(/\s+/g, ' ')
    .trim();
}

// « Deux seniors victimes d'une arnaque - Actu.fr » → on retire « - Actu.fr ».
// Uniquement si le suffixe correspond VRAIMENT au journal annoncé : sinon on
// amputerait un titre qui contient légitimement un tiret.
function sansSuffixe(titre, journal) {
  const fin = ' - ' + journal;
  return titre.endsWith(fin) ? titre.slice(0, -fin.length).trim() : titre;
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
    // Google Actualités nomme le journal dans <source> et le recolle en fin
    // de titre : « Deux seniors victimes… - Actu.fr ». Affiché tel quel dans
    // l'appli, ce suffixe fait doublon avec l'étiquette de source.
    const journal = baliseTexte(bloc, 'source');
    out.push({
      titre: journal ? sansSuffixe(titre, journal) : titre,
      resume: baliseTexte(bloc, 'description'),
      url: baliseTexte(bloc, 'link'),
      date: baliseTexte(bloc, 'pubDate') || baliseTexte(bloc, 'dc:date'),
      journal: journal || ''
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
// ── Le tri supplémentaire réservé à la presse ────────────────────────────
// Un flux officiel ne publie que des communiqués. Google Actualités, lui,
// rend tout ce qui contient le mot. Relevé sur les résultats réels du
// 28 août 2026 : « un homme construit son propre amphithéâtre grec antique et
// arnaque les touristes », « les prépas en médecine », « cette annonce pour
// louer une chambre à 890 € ». Le mot y est, le sujet n'a rien à voir.
//
// Ce filtre écarte les publics qui ne sont pas le nôtre. Il ne prétend PAS
// faire le tri à lui seul : c'est un dégrossissage avant relecture humaine,
// et c'est bien pour ça que rien de tout ceci ne se publie sans un clic.
const HORS_SUJET_PRESSE = [
  // « universit » et non « universite » : sans la troncature, « arnaque aux
  // frais universitaireS » passait au travers. Vérifié sur les flux réels.
  'eleve', 'lyceen', 'etudiant', 'universit', 'prepa', 'parcoursup',
  'rentree scolaire', 'college ', 'bac ', 'ecole',
  'football', 'joueur', 'arbitre', 'transfert', 'match', 'championnat',
  'influenceur', 'tiktokeur', 'streamer', 'youtubeur', 'telerealite',
  // La politique emploie « escroquerie » comme insulte : « De l'escroquerie à
  // l'état pur », « Lecornu accuse LFI d'escroquerie ». Aucun de nos membres
  // n'est en danger.
  'melenchon', 'lecornu', 'lfi', 'depute', 'ministre', 'assemblee nationale',
  'budget 2027', 'inelig', 'municipales', 'president de la republique',
  // Hors de France : intéressant à lire, sans effet sur un habitant du Bas-Rhin.
  'en italie', 'en suisse', 'en belgique', 'au canada', 'aux etats-unis',
  'migros', 'luxembourg', 'quebec', 'vietnam', 'tunisie', 'tunisienne',
  'floride', 'theatre antique', 'amphitheatre',
  // Contenu publicitaire déguisé en alerte : « Comment [marque] détecte et
  // bloque les arnaques ». C'est une réclame, pas une information.
  'vpn', 'surfshark', 'nordvpn', 'binance', 'notre enquete sur',
  // L'escroquerie subie par une entreprise n'est pas celle que vit un retraité.
  'fraude au president', 'dirigeant', 'start-up', 'fonds d\'investissement'
];

// Même exigence que pour l'officiel, plus les exclusions de public.
function pertinentPourPresse(titre, resume) {
  if (!pertinentPourSenior(titre, resume)) return false;
  const tout = aplatir((titre || '') + ' ' + (resume || ''));
  return !HORS_SUJET_PRESSE.some(k => tout.indexOf(k) !== -1);
}

// ── Une histoire, une entrée ─────────────────────────────────────────────
// Une même affaire est reprise par tous les journaux : le 28 août 2026, la
// mésaventure bancaire d'une animatrice de télévision revenait SIX fois, un
// article de MaVille cinq fois (un exemplaire par ville), l'arnaque Doctolib
// cinq fois. Sur 95 articles retenus, une bonne moitié était de la répétition.
// Personne ne relit 95 titres deux fois par jour ; l'outil serait abandonné en
// une semaine.
//
// On ne peut pas dédoublonner par URL — elles diffèrent toutes — ni par titre
// exact, pour la même raison. On compare donc les mots RARES : deux titres qui
// partagent au moins deux mots distinctifs racontent la même chose.
// « Doctolib » + « médical » suffisent ; « arnaque » + « victime », non, sinon
// tout serait confondu avec tout.
const MOTS_BANALS = [
  'arnaque', 'arnaques', 'escroquerie', 'escroqueries', 'fraude', 'victime',
  'victimes', 'attention', 'nouvelle', 'nouveau', 'euros', 'faux', 'fausse',
  'piege', 'pieges', 'comment', 'cette', 'votre', 'vous', 'alerte', 'alertent',
  'contre', 'toujours', 'encore', 'aussi', 'meme', 'apres', 'avant', 'depuis',
  'plusieurs', 'milliers', 'personnes', 'francais', 'francaises', 'proteger',
  'eviter', 'savoir', 'faire', 'plus', 'moins', 'tout', 'tous', 'toute'
];

function motsRares(titre) {
  const vus = {};
  aplatir(titre).replace(/[^a-z0-9]+/g, ' ').split(' ').forEach(m => {
    if (m.length >= 5 && MOTS_BANALS.indexOf(m) === -1) vus[m] = true;
  });
  return Object.keys(vus);
}

// La somme volée est la signature la plus sûre d'un fait divers, et c'est
// justement celle que `motsRares` jetait : « 24 000 » se découpe en « 24 » et
// « 000 », deux jetons de moins de cinq lettres. Le banc d'essai l'a montré en
// laissant passer TROIS versions du même vol de 24 000 € (Le Progrès, Actu.fr,
// BuzzArena) et deux fois les 9 000 € d'Agathe Lecaron — écrits « 9000 » ici,
// « 9 000 » là, ce qui interdisait aussi la comparaison de titres.
//
// On recolle donc les groupes de chiffres avant de lire le nombre, et on ignore
// les millésimes : « Foire aux vins de Colmar 2026 » et « Impôts 2026 » n'ont
// rien à voir l'un avec l'autre.
function montants(titre) {
  // \u00a0 et \u202f : les espaces insécables que la presse glisse dans
  // « 24 000 ». Écrites en toutes lettres — un caractère invisible dans une classe
  // de caractères ne se relit pas.
  const t = aplatir(titre).replace(/[\u00a0\u202f\s]+/g, ' ');
  const out = [];
  const re = /\d[\d ]*\d|\d/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = parseInt(m[0].replace(/ /g, ''), 10);
    if (n >= 1000 && !(n >= 1900 && n <= 2100)) out.push(String(n));
  }
  return out;
}

function memeHistoire(titreA, titreB) {
  // Une somme identique suffit. Deux escroqueries distinctes portant sur le
  // même montant à l'euro près existent en théorie ; en pratique, sur une
  // fenêtre de quelques jours, c'est le même fait raconté deux fois. Et l'arbitrage
  // penche volontairement de ce côté : regrouper à tort coûte un article de
  // moins dans une file que quelqu'un valide à la main, tandis que séparer à
  // tort redonne les doublons qui font abandonner l'outil.
  const ma = montants(titreA), mb = montants(titreB);
  if (ma.some(n => mb.indexOf(n) !== -1)) return true;

  const a = motsRares(titreA), b = motsRares(titreB);
  if (a.length < 2 || b.length < 2) return false;
  let communs = 0;
  for (const m of a) if (b.indexOf(m) !== -1) communs++;
  return communs >= 2;
}

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
    let bruts = source.format === 'atom' ? parserAtom(xml) : parserRss(xml);
    if (!bruts.length) {
      console.error(`[alertes] source VIDE ou format inattendu : ${source.nom} ${source.url}`);
      return [];
    }
    // Exigence propre à la source, quand on ne peut pas faire confiance au
    // moteur de recherche pour la respecter (voir `exige` plus haut).
    if (source.exige) {
      bruts = bruts.filter(b => {
        const t = aplatir(b.titre + ' ' + (b.resume || ''));
        return source.exige.some(k => t.indexOf(k) !== -1);
      });
    }
    return bruts.map(b => ({
      title: b.titre,
      body: b.resume ? b.resume.slice(0, 400) : '',
      url: b.url,
      // Pour la presse, on nomme le journal — « Actu.fr · presse » vaut mieux
      // que « presse » tout court : le lecteur juge la source.
      //
      // Réservé à la presse à dessein : le flux de la CNIL porte lui aussi une
      // balise <source> (« RSS - Actualités CNIL »), et sans cette condition
      // l'étiquette devenait « RSS - Actualités CNIL · CNIL · officiel ».
      // C'est le banc d'essai qui l'a montré, pas la relecture.
      source: (source.confiance === 'presse' && b.journal)
        ? b.journal + ' · ' + source.etiquette
        : source.etiquette,
      confiance: source.confiance || 'officiel',
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

// Le moteur commun. `confiance` dit quelles sources lire, `tri` comment
// filtrer. Dédoublonnage par URL, du plus récent au plus ancien.
// `maxJours` évite d'annoncer comme « en ce moment » un article de mars.
async function collecter(maxJours, confiance, tri, grouper) {
  const limite = maxJours ? Date.now() - maxJours * 24 * 3600 * 1000 : null;
  const choisies = SOURCES.filter(s => (s.confiance || 'officiel') === confiance);
  const paquets = await Promise.all(choisies.map(lireSource));

  const vues = new Set();
  const retenues = [];
  for (const item of [].concat.apply([], paquets)) {
    if (!item.url || vues.has(item.url)) continue;
    if (!tri(item.title, item.body)) continue;
    if (limite && item.published && new Date(item.published).getTime() < limite) continue;
    vues.add(item.url);
    retenues.push(item);
  }

  retenues.sort((a, b) =>
    new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime());

  // Le regroupement vient APRÈS le tri par date : sur une même affaire, c'est
  // la reprise la plus récente qu'on garde.
  //
  // Réservé à la presse. Deux communiqués officiels peuvent légitimement
  // partager deux mots rares (« hameçonnage impôts » revient chaque année) :
  // les confondre ferait disparaître une vraie alerte, ce qui est exactement
  // le genre de silence qu'on cherche à supprimer.
  if (!grouper) return retenues;
  const uniques = [];
  for (const item of retenues) {
    if (!uniques.some(u => memeHistoire(u.title, item.title))) uniques.push(item);
  }
  return uniques;
}

// ATTENTION avant de toucher à cette fonction : trois appelants en dépendent,
// et l'un d'eux (cyber-alerts.js) ENVOIE DES EMAILS AUX CLIENTS PAYANTS, un
// autre (list-alerts.js) alimente l'appli en direct quand la table est vide.
// Elle ne doit donc JAMAIS renvoyer autre chose que de l'officiel. La presse
// passe par collecterPresse(), qui est opt-in : une source non relue ne peut
// pas se retrouver chez un client par simple oubli d'un appelant.
async function collecterAlertes(maxJours) {
  return collecter(maxJours, 'officiel', pertinentPourSenior, false);
}

// Rien de ce que renvoie cette fonction n'est publiable en l'état : le seul
// appelant légitime est national-alerts.js, qui l'enregistre en « à valider ».
async function collecterPresse(maxJours) {
  return collecter(maxJours, 'presse', pertinentPourPresse, true);
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
    const confiance = source.confiance || 'officiel';
    const tri = confiance === 'presse' ? pertinentPourPresse : pertinentPourSenior;
    const etat = { nom: source.nom, url: source.url, http: 0, confiance,
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
      etat.retenues = bruts.filter(b => tri(b.titre, b.resume)).length;
    } catch (e) {
      etat.erreur = (e && e.message) || 'erreur inconnue';
    }
    return etat;
  }));
}

module.exports = {
  SOURCES,
  collecterAlertes,
  collecterPresse,
  diagnostiquer,
  pertinentPourSenior,
  pertinentPourPresse,
  memeHistoire,
  motsRares,
  sansSuffixe,
  parserRss,
  parserAtom,
  decoder,
  aplatir
};
