// ════════════════════════════════════════════
// DESPY — Transformer un article de presse en email de PRÉVENTION
//
// Le problème que ça résout : un titre de Google Actualités
// (« SIM-swapping : un Strasbourgeois perd 40 000 € ») raconte ce qui est
// ARRIVÉ à quelqu'un d'autre. Envoyé tel quel à un abonné de 75 ans, ça
// produit de l'inquiétude et zéro protection — c'est du relais de presse.
// L'email `cyber_alert` existant fait exactement ça : il recopie 400
// caractères de la dépêche et s'arrête là.
//
// Ce que l'abonné doit recevoir à la place : comment le piège fonctionne,
// à quoi il le reconnaîtra dans SA propre journée, quels gestes faire, et
// la ligne rouge à ne jamais franchir. Ça, aucun titre de presse ne le
// contient — il faut l'écrire.
//
// ── La règle qui compte ──
// Le modèle ne dispose que du titre et d'un extrait. Il a donc l'interdiction
// explicite d'inventer le moindre fait absent de la source : pas de montant,
// pas de ville, pas de nombre de victimes, pas de nom d'entreprise. Il décrit
// le MÉCANISME du type d'arnaque, qui lui est de notoriété publique. Un email
// de prévention qui invente un chiffre est un email qui ment à des gens qui
// nous font confiance — c'est le seul défaut qu'on ne peut pas rattraper.
//
// ── Et si la génération échoue ──
// On renvoie `null`, et l'appelant n'envoie RIEN. Un email de prévention dont
// la prévention a échoué, c'est le relais de presse qu'on cherchait justement
// à ne plus envoyer. Mieux vaut prévenir l'administrateur que d'écrire à
// tout le fichier pour ne rien dire.
// ════════════════════════════════════════════

const MODELE = 'claude-sonnet-4-5-20250929';

// Bornes de sécurité. Elles ne sont pas cosmétiques : un champ vide casse la
// mise en page de l'email, et un champ de 3 000 caractères la casse aussi.
const BORNES = {
  titre:     { min: 10, max: 110 },
  accroche:  { min: 40, max: 400 },
  mecanisme: { min: 80, max: 700 },
  concerne:  { min: 15, max: 220 }
};
const LISTES = {
  signes:   { min: 3, max: 5, maxLong: 200 },
  reflexes: { min: 3, max: 5, maxLong: 240 },
  jamais:   { min: 2, max: 4, maxLong: 160 }
};

function prompt(article) {
  return `Tu écris pour Despy, un service français de protection contre les arnaques dont les abonnés ont majoritairement plus de 65 ans. Tu prépares un email de PRÉVENTION à partir d'un article de presse.

ARTICLE SOURCE
Titre : ${article.title}
Source : ${article.source || 'presse'}
Extrait : ${(article.body || '').slice(0, 900) || '(aucun extrait disponible)'}

TA MISSION
L'abonné ne doit pas apprendre ce qui est arrivé à quelqu'un d'autre : il doit repartir en sachant reconnaître ce piège et quoi faire. Identifie le TYPE d'arnaque dont parle l'article, puis explique-le.

INTERDICTION ABSOLUE — n'invente aucun fait qui ne soit pas dans le titre ou l'extrait ci-dessus : aucun montant, aucune ville, aucun nombre de victimes, aucune date, aucun nom d'entreprise ou de banque. Tu ne disposes que d'un titre : décris le MÉCANISME du type d'arnaque, qui est de notoriété publique, jamais les circonstances du cas particulier. Si l'article est trop vague pour identifier un type d'arnaque précis, réponds exactement : {"impossible": "raison courte"}

RÈGLES D'ÉCRITURE
- Vouvoiement, phrases courtes, ton calme et respectueux. On informe, on n'affole pas.
- Zéro jargon non expliqué. Si un terme technique est indispensable (hameçonnage, SIM-swapping), donne-le suivi de son explication en français simple entre parenthèses, une fois.
- Concret et sensoriel : ce que la personne VOIT ou ENTEND réellement (« on vous appelle en se présentant comme votre conseiller bancaire »), jamais l'abstraction (« usurpation d'identité »).
- Jamais de culpabilisation : ces arnaques piègent aussi des gens avertis, et le dire désamorce la honte qui empêche de porter plainte.
- Pas d'emoji, pas de majuscules d'insistance, pas de point d'exclamation.

RÉPONDS UNIQUEMENT PAR CET OBJET JSON, sans texte autour, sans bloc de code :
{
  "titre": "Le nom du piège, formulé comme une mise en garde utile et non comme un titre de journal. 110 caractères maximum.",
  "accroche": "2 phrases. Ce qui circule en ce moment, et pourquoi cet abonné est concerné.",
  "mecanisme": "3 à 4 phrases. Le déroulé du piège, étape par étape, du premier contact jusqu'au moment où l'argent ou le compte est perdu. C'est le coeur de l'email : comprendre le mécanisme est ce qui permet de le reconnaître sous une autre forme.",
  "concerne": "1 phrase. Qui est visé et par quel canal (téléphone, SMS, email, porte-à-porte).",
  "signes": ["3 à 5 signes concrets qui doivent mettre la puce à l'oreille, chacun une phrase courte à la deuxième personne"],
  "reflexes": ["3 à 5 gestes à faire, formulés à l'impératif, dans l'ordre où on les fait, et réalisables par quelqu'un qui n'est pas à l'aise avec la technique"],
  "jamais": ["2 à 4 lignes rouges absolues, très courtes, chacune commençant par un verbe à l'infinitif — ex : Ne jamais communiquer un code reçu par SMS"]
}`;
}

// Le modèle bavarde parfois autour du JSON (« Voici l'objet demandé : »), ou
// l'enrobe dans un bloc de code. On récupère le premier objet équilibré plutôt
// que de faire confiance à la mise en forme.
function extraireJSON(texte) {
  const debut = texte.indexOf('{');
  if (debut === -1) return null;
  let profondeur = 0, dansChaine = false, echappe = false;
  for (let i = debut; i < texte.length; i++) {
    const c = texte[i];
    if (echappe) { echappe = false; continue; }
    if (c === '\\') { echappe = true; continue; }
    if (c === '"') { dansChaine = !dansChaine; continue; }
    if (dansChaine) continue;
    if (c === '{') profondeur++;
    else if (c === '}') {
      profondeur--;
      if (profondeur === 0) {
        try { return JSON.parse(texte.slice(debut, i + 1)); }
        catch (e) { return null; }
      }
    }
  }
  return null;
}

// Validation stricte. Un email à demi rempli part quand même chez le client :
// personne ne le relit entre la génération et l'envoi. Le contrôle doit donc
// se faire ici, et refuser plutôt que rafistoler.
function valider(brut) {
  if (!brut || typeof brut !== 'object') return { ok: false, raison: 'réponse illisible' };
  if (brut.impossible) return { ok: false, raison: 'article trop vague : ' + String(brut.impossible).slice(0, 120) };

  const propre = {};
  for (const champ of Object.keys(BORNES)) {
    const v = typeof brut[champ] === 'string' ? brut[champ].trim() : '';
    if (v.length < BORNES[champ].min) return { ok: false, raison: `champ « ${champ} » vide ou trop court` };
    if (v.length > BORNES[champ].max) return { ok: false, raison: `champ « ${champ} » trop long (${v.length})` };
    propre[champ] = v;
  }

  for (const champ of Object.keys(LISTES)) {
    const b = LISTES[champ];
    const liste = Array.isArray(brut[champ])
      ? brut[champ].map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
      : [];
    if (liste.length < b.min) return { ok: false, raison: `liste « ${champ} » : ${liste.length} entrée(s), ${b.min} attendues` };
    if (liste.some(x => x.length > b.maxLong)) return { ok: false, raison: `liste « ${champ} » : une entrée dépasse ${b.maxLong} caractères` };
    propre[champ] = liste.slice(0, b.max);
  }

  return { ok: true, contenu: propre };
}

// Renvoie { ok:true, contenu } ou { ok:false, raison }. Ne lève jamais :
// l'appelant est déclenché par un clic dans un email, il n'a personne pour
// rattraper une exception.
async function preparerPrevention(article) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, raison: 'ANTHROPIC_API_KEY absente' };
  }
  if (!article || !article.title) {
    return { ok: false, raison: 'article sans titre' };
  }

  let derniereRaison = 'inconnue';
  // Deux tentatives : un JSON mal formé est le mode d'échec le plus courant et
  // le plus facilement corrigé par un simple nouvel essai.
  for (let essai = 1; essai <= 2; essai++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': process.env.ANTHROPIC_API_KEY
        },
        body: JSON.stringify({
          model: MODELE,
          max_tokens: 2000,
          // Une consigne de prévention n'a pas à varier d'un envoi à l'autre.
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt(article) }]
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!res.ok) {
        derniereRaison = `Anthropic HTTP ${res.status}`;
        console.warn(`[prevention] essai ${essai} : ${derniereRaison}`);
        continue;
      }

      const data = await res.json();
      const texte = (data.content && data.content[0] && data.content[0].text) || '';
      const verdict = valider(extraireJSON(texte));

      if (verdict.ok) return verdict;

      derniereRaison = verdict.raison;
      console.warn(`[prevention] essai ${essai} rejeté : ${derniereRaison}`);
      // Un article que le modèle juge trop vague le restera au second essai.
      if (/trop vague/.test(derniereRaison)) break;

    } catch (e) {
      derniereRaison = (e && e.message) || 'erreur réseau';
      console.warn(`[prevention] essai ${essai} : ${derniereRaison}`);
    }
  }

  return { ok: false, raison: derniereRaison };
}

module.exports = { preparerPrevention, valider, extraireJSON, MODELE, BORNES, LISTES };
