// ════════════════════════════════════════════
// DESPY — La veille presse de la semaine
// Cron : le lundi à 7 h UTC → 0 7 * * 1 (voir netlify.toml)
//
// La presse était proposée deux fois par jour, avec la tournée des alertes
// officielles : jusqu'à dix articles par passage, deux emails de validation
// par jour. Relevé sur les flux réels du 18 octobre 2026 : 35 articles en une
// semaine, dont un quart hors sujet. Une boîte qui reçoit quatorze emails de
// tri par semaine finit par ne plus être triée — et la validation à la main,
// qui est toute la raison d'être de ce circuit, cesse d'avoir lieu.
//
// Désormais : UN email le lundi, CINQ articles, les plus utiles d'abord. Les
// alertes officielles (CNIL, ANSSI, Cybermalveillance), elles, restent
// publiées automatiquement deux fois par jour par national-alerts.js : rien de
// ce qui est urgent et vérifié n'attend le lundi.
//
// Rien de la presse ne se publie sans un clic (voir _presse-recap.js et
// alert-moderate.js). Ce module ne fait que choisir quoi proposer.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { collecterPresse, aplatir } = require('./_alert-sources');
const { envoyerRecapPresse } = require('./_presse-recap');

// Fenêtre : chaque flux borne déjà la sienne (7 jours pour le national, 30
// pour le local, dans la requête même). Ce plafond ne fait qu'épouser la plus
// large des deux — un fait divers local de trois semaines reste utile.
const PRESSE_JOURS = 30;

// Cinq, pas dix : un email qu'on lit en entier vaut mieux qu'un email qu'on
// survole. Les articles non proposés ne sont pas perdus : absents de la
// table, ils restent candidats la semaine suivante tant qu'ils sont dans la
// fenêtre.
const PRESSE_MAX = 5;

// Ce qui rend un article utile à quelqu'un qui le lira : il dit comment
// l'arnaque se présente. « Les 6 signes d'un faux commissaire de justice »
// arme le lecteur ; « un trentenaire condamné à Mulhouse », non.
const INDICES_MECANISME = [
  'comment', 'signe', 'reconnaitre', 'reperer', 'eviter', 'attention', 'met en garde',
  // « appel » précédé d'une espace : « rappel à l'ordre » n'explique rien.
  'mettent en garde', 'alerte', 'nouvelle arnaque', 'sms', ' appel', 'telephon',
  'courrier', 'mail', 'message', 'faux ', 'fausse'
];

function score(article) {
  const t = ' ' + aplatir(article.title || '');
  const local = (article.source || '').indexOf('locale') !== -1;
  const mecanisme = INDICES_MECANISME.some(k => t.indexOf(k) !== -1);
  // Le mécanisme pèse plus que le lieu : une arnaque expliquée, d'où qu'elle
  // vienne, protège mieux qu'un fait divers de Strasbourg qui n'explique rien.
  // À mécanisme égal, le Bas-Rhin passe devant.
  return (mecanisme ? 2 : 0) + (local ? 1 : 0);
}

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Sans la colonne `status`, écrire un article reviendrait à le PUBLIER
    // (l'absence de statut vaut « publié » pour l'historique). Le seul repli
    // acceptable est de s'abstenir.
    const { error: sonde } = await supabase.from('national_alerts').select('status').limit(1);
    if (sonde) {
      console.error('[presse] colonne `status` absente — veille presse suspendue :', sonde.message);
      return { statusCode: 200, body: JSON.stringify({ suspendue: true }) };
    }

    const presse = await collecterPresse(PRESSE_JOURS);

    // Déjà vu, quel que soit son statut : un article REJETÉ ne doit pas revenir
    // la semaine suivante.
    const nouveaux = [];
    for (const article of presse) {
      const { data } = await supabase.from('national_alerts').select('id').eq('url', article.url).limit(1);
      if (!(data && data.length)) nouveaux.push(article);
    }

    // Les plus utiles d'abord, puis les plus récents.
    nouveaux.sort((a, b) => (score(b) - score(a))
      || (new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime()));
    const choisis = nouveaux.slice(0, PRESSE_MAX);

    const enAttente = [];
    for (const article of choisis) {
      const { data, error } = await supabase.from('national_alerts').insert({
        title: article.title,
        // Pas le « résumé » de Google Actualités : ce n'est que le titre
        // répété suivi du nom du journal, et l'appli l'affichait tel quel.
        body: '',
        source: article.source,
        url: article.url,
        status: 'a_valider',
        confiance: 'presse',
        created_at: article.published || new Date().toISOString()
      }).select('id').maybeSingle();
      if (error) { console.error('[presse] non enregistré :', error.message, '—', article.title); continue; }
      if (data) enAttente.push({ id: data.id, ...article });
    }

    let recap = null;
    if (enAttente.length) {
      try {
        recap = await envoyerRecapPresse(enAttente, { nonRetenus: nouveaux.length - choisis.length });
      } catch (e) {
        // Les articles sont en base, ils restent en attente : on le dit, on ne
        // casse pas le passage pour autant.
        console.error('[presse] récapitulatif non envoyé :', e && e.message);
      }
    }

    const bilan = { trouves: presse.length, nouveaux: nouveaux.length, proposes: enAttente.length, recap };
    console.log('[presse]', JSON.stringify(bilan));
    return { statusCode: 200, body: JSON.stringify(bilan) };
  } catch (err) {
    console.error('veille-presse error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
