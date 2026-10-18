// ════════════════════════════════════════════
// DESPY — Push d'alertes nationales
// Cron : 2 fois par jour → 0 9,18 * * * (voir netlify.toml)
// 1. Sources publiques françaises (CNIL, Cybermalveillance, ANSSI)
//    → voir _alert-sources.js, qui décide aussi de ce qui parle à un senior
// 2. Vagues d'arnaques chez nos propres membres → voir _vagues.js
// 3. Fiches d'arnaques de saison → voir _calendrier-arnaques.js
// 4. Push à toutes les subscriptions actives (abonnés ou gratuits)
//
// La presse n'est plus ici : elle est proposée une fois par semaine par
// veille-presse.js. Deux emails de tri par jour, c'était trop pour être lu.
//
// Historique : ce robot n'a jamais rien envoyé. Il n'interrogeait que le
// CERT-FR, qui ne publie que des avis de failles logicielles destinés aux
// administrateurs système — aucun ne pouvait passer un filtre grand public.
// Les sources vivent désormais dans _alert-sources.js, partagé avec
// cyber-alerts.js et list-alerts.js pour qu'il n'existe qu'une définition.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { envoyerPush, tagDepuis } = require('./_push');
const { collecterAlertes } = require('./_alert-sources');
const { fichesAPublier } = require('./_calendrier-arnaques');
const { detecterVagues } = require('./_vagues');

// On ne stocke que ce qui a moins de 120 jours : au-delà, ce n'est plus une
// alerte, c'est de l'archive — et l'afficher comme « en ce moment » serait faux.
const FENETRE_JOURS = 120;

// Une notification push ne se justifie que pour un événement récent. Sans ce
// garde-fou, la toute première exécution réveillerait tout le monde avec des
// articles de plusieurs mois.
const PUSH_JOURS = 12;

function recente(alerte, jours) {
  if (!alerte.published) return false;
  const t = new Date(alerte.published).getTime();
  return !isNaN(t) && t >= Date.now() - jours * 24 * 3600 * 1000;
}

// La plomberie web-push vit dans _push.js, partagée avec « Publier et
// prévenir ». Ici on ne décide plus que du texte affiché sur l'écran.
function sendPushToAll(supabase, alert) {
  return envoyerPush(supabase, {
    title: alert.title.length > 80 ? alert.title.slice(0, 77) + '…' : alert.title,
    body: alert.body || ('Source : ' + (alert.source || 'Despy')),
    url: alert.url || 'https://despy.fr',
    tag: tagDepuis(alert.url || alert.title)
  });
}

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement (pas d'appel HTTP)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 0. La colonne `status` existe-t-elle ?
    //
    // Elle est ajoutée à la main dans Supabase (sql_migration_veille_presse.sql).
    // Entre le déploiement du code et l'exécution du script, il s'écoule le
    // temps qu'il s'écoule — et pendant ce temps toute insertion mentionnant
    // `status` échoue. Sans cette vérification, le robot s'arrêterait net et
    // l'appli cesserait de recevoir des alertes sans que rien ne le dise.
    //
    // Sans elle, l'officiel continue d'être publié comme avant, sans statut —
    // l'absence de statut vaut « publié ». (La presse, qui elle ne doit jamais
    // être écrite sans statut, est dans veille-presse.js et s'y abstient.)
    const { error: sonde } = await supabase
      .from('national_alerts').select('status').limit(1);
    const validationPrete = !sonde;
    if (!validationPrete) {
      console.error('[alertes] colonne `status` absente —'
        + ' sql_migration_veille_presse.sql n\'a pas encore été exécuté.'
        + ' Alertes officielles écrites sans statut. Détail :',
        sonde.message);
    }

    // 1. Alertes externes (déjà filtrées grand public), vagues internes, et
    //    fiches de saison (voir _calendrier-arnaques.js).
    const [externes, vagues, saison] = await Promise.all([
      collecterAlertes(FENETRE_JOURS),
      detecterVagues(supabase),
      fichesAPublier(supabase)
    ]);
    const toutes = externes;
    console.log(`[alertes] ${externes.length} externes retenues,`
      + ` ${vagues.length} vagues internes, ${saison.length} fiche(s) de saison`);

    // 2. Écarter celles déjà connues (table national_alerts)
    //
    // `limit(1)` et non `maybeSingle()` : cette dernière lève une erreur dès
    // que DEUX lignes portent la même URL. Or nos propres publications en
    // partagent forcément — les vagues pointent toutes vers la page d'alertes,
    // et trois fiches de saison mènent à impots.gouv.fr. La lecture ne doit pas
    // dépendre d'une unicité que nos données ne respectent pas.
    //
    // Aucun filtre sur le statut : ce qui est en base, quel que soit son sort,
    // n'est pas réécrit. (Le même principe empêche veille-presse.js de
    // reproposer un article rejeté.)
    const dejaVue = async (url) => {
      const { data } = await supabase
        .from('national_alerts')
        .select('id')
        .eq('url', url)
        .limit(1);
      return !!(data && data.length);
    };

    const nouvelles = [];
    for (const alerte of toutes) {
      if (!(await dejaVue(alerte.url))) nouvelles.push(alerte);
    }

    // Vagues et fiches de saison ne passent pas par ce dédoublonnage-là : elles
    // partagent toutes la même URL, et dédoublonner par URL n'en aurait laissé
    // passer qu'une seule dans toute la vie du service. Elles se dédoublonnent
    // par TITRE, en amont, chacune dans son module.
    //
    // Ordre : une vague en cours d'abord — elle touche nos membres aujourd'hui —
    // puis la fiche de saison, puis les communiqués qui décrivent ce qui est
    // déjà arrivé.
    nouvelles.unshift(...vagues, ...saison);

    if (nouvelles.length === 0) {
      console.log('[alertes] aucune nouveauté');
      return { statusCode: 200, body: JSON.stringify({ new: 0 }) };
    }

    // 3. Enregistrer TOUTES les nouvelles (l'appli les affichera), mais ne
    //    notifier que les récentes : on enregistre l'historique sans réveiller
    //    les gens pour un article de trois mois.
    const resultats = [];
    let notifiees = 0;
    for (const alerte of nouvelles) {
      const ligne = {
        title: alerte.title,
        body: alerte.body || '',
        source: alerte.source,
        url: alerte.url,
        created_at: alerte.published || new Date().toISOString()
      };
      // Explicite alors que NULL vaudrait déjà « publié » : ce qu'on écrit
      // aujourd'hui doit se lire sans connaître l'histoire de la colonne.
      // Seules les lignes antérieures à la migration ont un statut vide.
      if (validationPrete) {
        ligne.status = 'publie';
        ligne.confiance = (alerte.source || '').indexOf('Despy') !== -1 ? 'despy' : 'officiel';
      }
      const { error } = await supabase.from('national_alerts').insert(ligne);
      // Bruyant : une insertion muette est ce qui a masqué le problème avant.
      if (error) {
        console.error('[alertes] insertion impossible:', error.message, '—', alerte.title);
        continue;
      }
      if (notifiees < 2 && recente(alerte, PUSH_JOURS)) {
        const r = await sendPushToAll(supabase, alerte);
        resultats.push({ title: alerte.title, ...r });
        notifiees++;
      }
    }

    console.log('[alertes] enregistrées:', nouvelles.length, '| push:', resultats);
    return {
      statusCode: 200,
      body: JSON.stringify({ new: nouvelles.length, pushed: resultats })
    };

  } catch (err) {
    console.error('national-alerts error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
