// ════════════════════════════════════════════
// DESPY — Liste des alertes nationales récentes
//
// Lecture publique (information non sensible) : ce que l'appli affiche dans
// « Alertes nationales » et dans le bandeau d'accueil. Alimentée par le cron
// national-alerts.js, qui écrit dans la table national_alerts.
//
// Le tri « est-ce que ça parle à une personne de 70 ans ? » vit dans
// _alert-sources.js. Il est réappliqué ici, à la lecture, comme filet : si un
// jour une source change de ton, l'appli ne se met pas à afficher du jargon.
//
// Deux ajouts par rapport à la version précédente :
//   • un âge maximum — une alerte de mars n'est pas une alerte « en ce moment » ;
//   • `probleme` dans la réponse quand la base refuse, au lieu d'un tableau
//     vide indistinguable d'un « tout va bien » (c'est ce silence qui a laissé
//     l'écran afficher « Aucune alerte en cours » pendant des mois).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { pertinentPourSenior, collecterAlertes } = require('./_alert-sources');

const AGE_MAX_JOURS = 120;

// Filet de sécurité : si la table ne donne rien — cron pas encore passé,
// table vide, base indisponible — on interroge les sources en direct plutôt
// que d'afficher « Aucune alerte en cours ». C'est ce message rassurant et
// faux qui a masqué la panne pendant des mois : mieux vaut une seconde de
// latence qu'un mensonge tranquille. Ne coûte rien le reste du temps, puisque
// dès que le cron alimente la table, ce chemin n'est plus emprunté.
//
// `collecterAlertes` et NON `collecterPresse`, délibérément : ce chemin publie
// sans relecture humaine. Il ne doit donc voir que les sources officielles. La
// presse n'entre dans l'appli que par la file de validation.
async function enDirect() {
  const brutes = await collecterAlertes(AGE_MAX_JOURS);
  return brutes.slice(0, 15).map(a => ({
    title: a.title,
    body: a.body,
    source: a.source,
    url: a.url,
    created_at: a.published
  }));
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // « status IS NULL OR status = 'publie' » et non « status = 'publie' » :
    // toutes les alertes déjà en base sont antérieures à la colonne et n'ont
    // donc pas de statut. Les exiger publiées explicitement aurait vidé
    // l'écran d'un coup au déploiement — exactement le « Aucune alerte en
    // cours » que ce module a mis des mois à cesser d'afficher à tort.
    const { data, error } = await supabase
      .from('national_alerts')
      .select('title, body, source, url, created_at')
      .or('status.is.null,status.eq.publie')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) {
      console.error('[list-alerts] base indisponible:', error.message);
      try {
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ alerts: await enDirect(), origine: 'direct', probleme: 'base' })
        };
      } catch (e2) {
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ alerts: [], probleme: 'base' })
        };
      }
    }

    const limite = Date.now() - AGE_MAX_JOURS * 24 * 3600 * 1000;
    const alerts = (data || [])
      .filter(a => {
        const t = new Date(a.created_at).getTime();
        return isNaN(t) || t >= limite;
      })
      .filter(a => {
        // Les vagues détectées chez nous sont pertinentes par construction :
        // elles viennent de ce que nos propres utilisateurs ont signalé.
        if ((a.source || '').indexOf('Despy') !== -1) return true;
        return pertinentPourSenior(a.title, a.body);
      })
      .slice(0, 15);

    if (alerts.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ alerts, origine: 'base' }) };
    }

    // Table vide : on va voir à la source.
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ alerts: await enDirect(), origine: 'direct' })
    };

  } catch (err) {
    console.error('[list-alerts] erreur:', err && err.message);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ alerts: [], probleme: 'serveur' })
    };
  }
};
