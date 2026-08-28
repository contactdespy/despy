// ════════════════════════════════════════════
// DESPY — Push d'alertes nationales
// Cron : 2 fois par jour → 0 9,18 * * * (voir netlify.toml)
// 1. Sources publiques françaises (CNIL, Cybermalveillance, ANSSI)
//    → voir _alert-sources.js, qui décide aussi de ce qui parle à un senior
// 2. Vagues d'arnaques chez nos propres membres → voir _vagues.js
// 3. Fiches d'arnaques de saison → voir _calendrier-arnaques.js
// 4. Push à toutes les subscriptions actives (abonnés ou gratuits)
//
// Historique : ce robot n'a jamais rien envoyé. Il n'interrogeait que le
// CERT-FR, qui ne publie que des avis de failles logicielles destinés aux
// administrateurs système — aucun ne pouvait passer un filtre grand public.
// Les sources vivent désormais dans _alert-sources.js, partagé avec
// cyber-alerts.js et list-alerts.js pour qu'il n'existe qu'une définition.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const { collecterAlertes, collecterPresse } = require('./_alert-sources');
const { fichesAPublier } = require('./_calendrier-arnaques');
const { detecterVagues } = require('./_vagues');
const { envoyerRecapPresse } = require('./_presse-recap');

// On ne stocke que ce qui a moins de 120 jours : au-delà, ce n'est plus une
// alerte, c'est de l'archive — et l'afficher comme « en ce moment » serait faux.
const FENETRE_JOURS = 120;

// Une notification push ne se justifie que pour un événement récent. Sans ce
// garde-fou, la toute première exécution réveillerait tout le monde avec des
// articles de plusieurs mois.
const PUSH_JOURS = 12;

// Chaque flux de presse borne DÉJÀ sa propre fenêtre, dans sa requête même :
// `when:7d` pour le national, `when:30d` pour le local. Ce plafond-ci n'est
// qu'un filet, et il doit donc épouser la plus large des deux.
//
// Il était à 10 jours dans la première version, ce qui aurait vidé le local
// sans rien dire : ce flux ne rend que 17 articles en 30 jours, et « Foire aux
// vins de Colmar : attention aux arnaques » a 26 jours. On aurait jeté la
// partie la plus précieuse — celle qui n'a aucun équivalent officiel — pour
// ne garder que le national, que tout le monde voit déjà passer.
//
// Un fait divers local de trois semaines reste utile : l'arnaque, elle,
// circule encore.
const PRESSE_JOURS = 30;

// Plafond par passage. Sur les flux réels, le premier passage proposerait 24
// articles d'un coup ; un email de 24 titres ne se lit pas, il se classe. On
// en propose dix, deux fois par jour — le reste sera repris au passage suivant
// puisqu'il reste, par construction, absent de la table.
const PRESSE_MAX = 10;

function recente(alerte, jours) {
  if (!alerte.published) return false;
  const t = new Date(alerte.published).getTime();
  return !isNaN(t) && t >= Date.now() - jours * 24 * 3600 * 1000;
}

async function sendPushToAll(supabase, alert) {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth');
  if (error || !subs || subs.length === 0) return { sent: 0, failed: 0 };

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:contact@despy.fr',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const payload = JSON.stringify({
    title: alert.title.length > 80 ? alert.title.slice(0, 77) + '…' : alert.title,
    body: alert.body || ('Source : ' + (alert.source || 'Despy')),
    url: alert.url || 'https://despy.fr',
    tag: 'despy-' + Buffer.from(alert.url || alert.title).toString('base64').slice(0, 24)
  });

  let sent = 0, failed = 0;
  const expiredEndpoints = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 24 * 3600 }
      );
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) expiredEndpoints.push(sub.endpoint);
    }
  }

  // Nettoyer les subscriptions expirées
  if (expiredEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
  }

  return { sent, failed, cleaned: expiredEndpoints.length };
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
    // Le repli est volontairement ASYMÉTRIQUE : on continue de publier
    // l'officiel comme avant, mais on ne touche pas à la presse. Écrire un
    // article de presse sans statut reviendrait à le PUBLIER — l'absence de
    // statut valant « publié » pour ne pas faire disparaître l'historique.
    // Le seul repli acceptable est donc de s'abstenir.
    const { error: sonde } = await supabase
      .from('national_alerts').select('status').limit(1);
    const validationPrete = !sonde;
    if (!validationPrete) {
      console.error('[alertes] colonne `status` absente —'
        + ' sql_migration_veille_presse.sql n\'a pas encore été exécuté.'
        + ' Veille presse suspendue, alertes officielles maintenues. Détail :',
        sonde.message);
    }

    // 1. Alertes externes (déjà filtrées grand public), vagues internes, et
    //    fiches de saison (voir _calendrier-arnaques.js).
    const [externes, presse, vagues, saison] = await Promise.all([
      collecterAlertes(FENETRE_JOURS),
      collecterPresse(PRESSE_JOURS),
      detecterVagues(supabase),
      fichesAPublier(supabase)
    ]);
    const toutes = externes;
    console.log(`[alertes] ${externes.length} externes retenues, ${presse.length} de presse,`
      + ` ${vagues.length} vagues internes, ${saison.length} fiche(s) de saison`);

    // 2. Écarter celles déjà connues (table national_alerts)
    //
    // `limit(1)` et non `maybeSingle()` : cette dernière lève une erreur dès
    // que DEUX lignes portent la même URL. Or nos propres publications en
    // partagent forcément — les vagues pointent toutes vers la page d'alertes,
    // et trois fiches de saison mènent à impots.gouv.fr. La lecture ne doit pas
    // dépendre d'une unicité que nos données ne respectent pas.
    //
    // Aucun filtre sur le statut, et c'est essentiel pour la presse : un
    // article REJETÉ à la main doit rester connu, sinon le passage suivant le
    // reproposerait, et on rejetterait deux fois par jour le même article
    // jusqu'à ce qu'il sorte de la fenêtre.
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

    // La presse suit le même dédoublonnage mais un tout autre destin : elle
    // n'est pas publiée, elle est PROPOSÉE. Plafonnée par passage, et le local
    // d'abord — une arnaque signalée à Strasbourg vaut plus pour nos membres
    // qu'une dépêche nationale que tout le monde verra de toute façon.
    const presseNouvelle = [];
    const parLocalDAbord = (validationPrete ? presse : []).slice().sort((a, b) => {
      const l = s => (s.source || '').indexOf('locale') !== -1 ? 0 : 1;
      return l(a) - l(b);
    });
    for (const article of parLocalDAbord) {
      if (presseNouvelle.length >= PRESSE_MAX) break;
      if (!(await dejaVue(article.url))) presseNouvelle.push(article);
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

    if (nouvelles.length === 0 && presseNouvelle.length === 0) {
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

    // 4. La presse : enregistrée en attente, JAMAIS poussée, jamais affichée.
    //    Elle n'existe pour l'instant que dans un email de validation.
    //
    //    On récupère l'id rendu par l'insertion : c'est lui qui signera les
    //    liens « Publier » / « Rejeter ». Sans `.select()`, il faudrait relire
    //    la ligne juste écrite — un aller-retour de plus et une occasion de se
    //    tromper de ligne quand deux articles portent le même titre.
    const enAttente = [];
    for (const article of presseNouvelle) {
      const { data, error } = await supabase.from('national_alerts').insert({
        title: article.title,
        body: article.body || '',
        source: article.source,
        url: article.url,
        status: 'a_valider',
        confiance: 'presse',
        created_at: article.published || new Date().toISOString()
      }).select('id').maybeSingle();

      if (error) {
        console.error('[alertes] presse non enregistrée:', error.message, '—', article.title);
        continue;
      }
      if (data) enAttente.push({ id: data.id, ...article });
    }

    // Un seul email pour tout le passage. Un email par article, c'est dix
    // emails deux fois par jour : la boîte devient le problème et la
    // validation n'est plus faite.
    let recap = null;
    if (enAttente.length) {
      try {
        recap = await envoyerRecapPresse(enAttente);
      } catch (e) {
        // L'email n'est pas la source de vérité : les articles sont en base,
        // ils attendront le prochain récapitulatif. On le dit, on ne casse pas
        // le passage pour autant.
        console.error('[alertes] récapitulatif presse non envoyé:', e && e.message);
      }
    }

    console.log('[alertes] enregistrées:', nouvelles.length,
      '| presse en attente:', enAttente.length, '| push:', resultats);
    return {
      statusCode: 200,
      body: JSON.stringify({
        new: nouvelles.length,
        pushed: resultats,
        presse_en_attente: enAttente.length,
        recap
      })
    };

  } catch (err) {
    console.error('national-alerts error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
