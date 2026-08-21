// ════════════════════════════════════════════
// DESPY — La sentinelle des alertes
// Cron : chaque lundi à 8h → 0 6 * * 1 (voir netlify.toml)
//
// Pourquoi elle existe : tout le reste de la chaîne est automatique, sauf une
// chose — SAVOIR qu'elle s'est cassée. Le jour où la CNIL change l'adresse de
// son flux, le robot ne trouve rien, l'écrit dans un journal Netlify que
// personne ne lit, et l'appli affiche « Aucune alerte en cours. Tant mieux ! ».
// Tout a l'air normal. C'est exactement ce qui s'est produit pendant des mois.
//
// Elle n'envoie un email QUE si quelque chose ne va pas. Pas de rapport
// hebdomadaire « tout va bien » : un email qu'on reçoit toutes les semaines
// finit par ne plus être ouvert, et le jour où il dit l'inverse, on ne le voit
// pas. Le silence redevient donc une information fiable.
//
// Trois symptômes, trois questions différentes :
//   1. une source ne répond plus         → l'adresse a changé, ou le site est HS
//   2. une source répond mais est vide   → le format a changé, le parseur est aveugle
//   3. la base n'a rien reçu depuis 3 sem → le robot ne tourne plus, ou n'écrit plus
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { diagnostiquer } = require('./_alert-sources');

// Trois semaines sans la moindre alerte enregistrée. Assez long pour qu'un
// mois d'août calme ne déclenche rien, assez court pour ne pas laisser une
// panne s'installer jusqu'à ce qu'un client la découvre à notre place.
const SILENCE_JOURS = 21;

// L'ANSSI est un cas à part, et c'est voulu : le CERT-FR ne publie que des
// avis techniques, dont aucun ne s'adresse à nos abonnés. Zéro alerte retenue
// chez elle est NORMAL — s'en alarmer chaque semaine dresserait à ignorer la
// sentinelle. On vérifie seulement qu'elle répond et qu'on sait la lire.
const SANS_RETENUE_ATTENDUE = ['ANSSI'];

function destinataire() {
  const brut = String(process.env.ADMIN_EMAIL || '').split(',')[0].trim();
  return brut || 'contact.despy@gmail.com';
}

function corpsHtml(problemes, etats, derniere) {
  const ligne = (e) => {
    const souci = e.erreur ? e.erreur
      : e.http !== 200 ? ('HTTP ' + e.http)
      : e.entrees === 0 ? 'illisible'
      : e.entrees + ' entrées, ' + e.retenues + ' retenues';
    const rouge = e.erreur || e.http !== 200 || e.entrees === 0;
    return '<tr>'
      + '<td style="padding:6px 12px 6px 0;font-weight:700">' + e.nom + '</td>'
      + '<td style="padding:6px 0;color:' + (rouge ? '#b91c1c' : '#166534') + '">'
      + souci + '</td></tr>';
  };

  return '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\','
    + 'Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6;'
    + 'max-width:600px;margin:0 auto;padding:24px">'
    + '<h2 style="font-size:18px;margin:0 0 4px">Les alertes ne remontent plus normalement</h2>'
    + '<p style="color:#555;margin:0 0 20px;font-size:13px">Message automatique — '
    + 'tu ne le reçois que quand il y a quelque chose à regarder.</p>'
    + '<ul style="padding-left:20px;margin:0 0 22px">'
    + problemes.map(p => '<li style="margin-bottom:8px">' + p + '</li>').join('')
    + '</ul>'
    + '<h3 style="font-size:14px;margin:0 0 8px;text-transform:uppercase;'
    + 'letter-spacing:.04em;color:#666">État des sources</h3>'
    + '<table style="border-collapse:collapse;font-size:14px;margin-bottom:22px">'
    + etats.map(ligne).join('') + '</table>'
    + '<p style="font-size:14px;margin:0 0 6px"><strong>Dernière alerte enregistrée :</strong> '
    + (derniere || 'aucune, jamais') + '</p>'
    + '<p style="font-size:13px;color:#555;margin:18px 0 0">Pour vérifier en une '
    + 'commande, sur le Mac : <code>python3 tests/test_alertes.py</code> — il '
    + 'télécharge les vrais flux et dit lequel a changé. Les adresses des sources '
    + 'se corrigent dans <code>netlify/functions/_alert-sources.js</code>.</p>'
    + '</div>';
}

// Le diagnostic, isolé de tout accès réseau et de toute base : c'est une
// fonction pure, donc on peut lui présenter une panne inventée et vérifier
// qu'elle crie — ce qui est le seul moyen de savoir qu'elle criera le jour où
// la panne sera vraie. Une sentinelle jamais mise à l'épreuve ne vaut rien.
function analyser(etats, recentes, erreurBase) {
  const problemes = [];

  for (const e of etats) {
    if (e.erreur) {
      problemes.push('<strong>' + e.nom + '</strong> injoignable : ' + e.erreur
        + ' — <span style="color:#666">' + e.url + '</span>');
    } else if (e.http !== 200) {
      problemes.push('<strong>' + e.nom + '</strong> répond ' + e.http
        + ' : l\'adresse du flux a probablement changé — <span style="color:#666">'
        + e.url + '</span>');
    } else if (e.entrees === 0) {
      problemes.push('<strong>' + e.nom + '</strong> répond bien mais on n\'y lit '
        + 'plus aucune entrée : le format du flux a changé, le parseur est aveugle.');
    }
  }

  // Aucune alerte retenue nulle part, ANSSI mise à part : soit toutes les
  // sources se sont tues en même temps (improbable), soit le tri ne
  // reconnaît plus rien de ce qu'elles publient.
  const utiles = etats.filter(e => SANS_RETENUE_ATTENDUE.indexOf(e.nom) === -1);
  const totalRetenues = utiles.reduce((n, e) => n + e.retenues, 0);
  if (utiles.length && totalRetenues === 0 && !problemes.length) {
    problemes.push('Les sources répondent et sont lisibles, mais <strong>plus '
      + 'aucun article ne passe le tri</strong>. Le vocabulaire des sources a '
      + 'sans doute évolué : la liste de mots-clés est à revoir.');
  }

  let derniere = null;
  if (erreurBase) {
    problemes.push('<strong>La base ne répond pas</strong> : ' + erreurBase.message);
  } else if (!recentes || !recentes.length) {
    problemes.push('<strong>La table <code>national_alerts</code> est vide</strong> : '
      + 'le robot n\'y a jamais rien écrit.');
  } else {
    const t = new Date(recentes[0].created_at);
    const jours = Math.floor((Date.now() - t.getTime()) / 86400000);
    derniere = t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      + ' — « ' + recentes[0].title + ' » (il y a ' + jours + ' jours)';
    if (jours > SILENCE_JOURS) {
      problemes.push('<strong>Rien de nouveau depuis ' + jours + ' jours.</strong> '
        + 'Le robot ne tourne plus, ou n\'écrit plus.');
    }
  }

  return { problemes, derniere };
}

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 1. Les sources répondent-elles, et sait-on encore les lire ?
    const etats = await diagnostiquer();

    // 2. Quand la base a-t-elle reçu quelque chose pour la dernière fois ?
    const { data: recentes, error: erreurBase } = await supabase
      .from('national_alerts')
      .select('created_at, title')
      .order('created_at', { ascending: false })
      .limit(1);

    const { problemes, derniere } = analyser(etats, recentes, erreurBase);

    if (!problemes.length) {
      console.log('[sentinelle] tout va bien — aucun email envoyé');
      return { statusCode: 200, body: JSON.stringify({ ok: true, etats }) };
    }

    const email = destinataire();
    const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify({
        type: 'custom',
        data: {
          email,
          subject: '⚠️ Despy — les alertes ne remontent plus',
          html: corpsHtml(problemes, etats, derniere)
        }
      })
    });

    // Si même l'alerte sur l'alerte échoue, autant le crier fort.
    if (!r.ok) console.error('[sentinelle] email non envoyé :', r.status, await r.text());
    console.log('[sentinelle]', problemes.length, 'problème(s) signalé(s) à', email);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, problemes: problemes.length, prevenu: email })
    };

  } catch (err) {
    console.error('[sentinelle] erreur:', err && err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};

// Exposés pour tests/test_sentinelle.py, qui lui présente des pannes inventées.
exports.analyser = analyser;
exports.corpsHtml = corpsHtml;
exports.SILENCE_JOURS = SILENCE_JOURS;
