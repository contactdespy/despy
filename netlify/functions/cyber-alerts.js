// ════════════════════════════════════════════
// DESPY — Alertes cybermenaces par email
// Cron : tous les 2 jours à 8h → 0 8 */2 * * (voir netlify.toml)
//
// Envoi : alerte complète aux abonnés payants + teaser aux comptes gratuits
//         (plafonné à 1 par passage pour ne pas spammer).
//
// Les sources et le tri « est-ce que ça parle à un senior ? » vivent dans
// _alert-sources.js. Avant, ce fichier avait sa propre liste de flux — dont
// un mort depuis des mois, avalé en silence — et sa propre liste de mots-clés
// qui ne correspondait à rien de ce que publient réellement les sources.
// Résultat : ce robot tournait tous les deux jours sans jamais rien envoyer.
//
// Mode à blanc : POST { next_run: "...", dry_run: true } → renvoie ce QUI
// SERAIT envoyé, sans envoyer. Indispensable pour vérifier une modification
// sans écrire à de vrais clients.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { collecterAlertes } = require('./_alert-sources');

// Un email d'alerte ne se justifie que si l'événement est récent. Sans ça, la
// première exécution après cette correction écrirait à tout le monde à propos
// d'articles vieux de plusieurs mois.
const EMAIL_JOURS = 14;

// Volontairement bas : une alerte par passage. Mieux vaut manquer une
// deuxième nouvelle que d'être perçu comme un expéditeur de spam.
const MAX_PAR_PASSAGE = 1;

function recente(alerte) {
  if (!alerte.published) return false;
  const t = new Date(alerte.published).getTime();
  return !isNaN(t) && t >= Date.now() - EMAIL_JOURS * 24 * 3600 * 1000;
}

async function envoyer(type, client, alerte) {
  const prenom = client.prenom || (client.name || '').split(' ')[0] || 'cher membre';
  const data = {
    email: client.email,
    prenom,
    alertTitle: alerte.title,
    alertSource: alerte.source
  };
  if (type === 'cyber_alert') {
    data.alertDesc = alerte.body;
    data.alertLink = alerte.url;
  }
  await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_SECRET || ''
    },
    body: JSON.stringify({ type, data })
  });
}

// abonne = true  → alerte complète aux abonnés payants
// abonne = false → teaser aux comptes gratuits
async function diffuser(supabase, alerte, abonne) {
  const { data: clients } = await supabase
    .from('clients')
    .select('email, name, prenom')
    .eq('subscribed', abonne);

  if (!clients || clients.length === 0) return 0;

  const type = abonne ? 'cyber_alert' : 'cyber_alert_free';
  let envoyes = 0;
  for (const client of clients) {
    try {
      await envoyer(type, client, alerte);
      envoyes++;
    } catch (e) {
      console.error('[cyber-alerts] envoi impossible', client.email, e && e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return envoyes;
}

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement

  let aBlanc = false;
  try { aBlanc = !!JSON.parse(event.body || '{}').dry_run; } catch (e) {}

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Alertes déjà envoyées, pour ne pas répéter la même deux fois.
    const { data: dejaEnvoyees, error: errLecture } = await supabase
      .from('sent_alerts')
      .select('alert_url')
      .order('created_at', { ascending: false })
      .limit(100);

    if (errLecture) {
      console.error('[cyber-alerts] table sent_alerts illisible:', errLecture.message);
      return { statusCode: 200, body: JSON.stringify({ erreur: 'sent_alerts', detail: errLecture.message }) };
    }

    const connues = new Set((dejaEnvoyees || []).map(a => a.alert_url));

    const candidates = (await collecterAlertes(EMAIL_JOURS))
      .filter(a => a.url && !connues.has(a.url))
      .filter(recente)
      .slice(0, MAX_PAR_PASSAGE);

    if (aBlanc) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          dry_run: true,
          seraient_envoyees: candidates.map(a => ({
            titre: a.title, source: a.source, date: a.published, url: a.url
          })),
          deja_connues: connues.size
        })
      };
    }

    if (candidates.length === 0) {
      console.log('[cyber-alerts] rien de neuf à annoncer');
      return { statusCode: 200, body: JSON.stringify({ alerts: 0, emails: 0 }) };
    }

    let total = 0;
    let teaserFait = false;
    for (const alerte of candidates) {
      console.log('[cyber-alerts] diffusion :', alerte.title);
      const envoyes = await diffuser(supabase, alerte, true);

      // Teaser aux comptes gratuits : une seule fois par passage.
      if (!teaserFait) {
        try { await diffuser(supabase, alerte, false); }
        catch (e) { console.error('[cyber-alerts] teaser:', e && e.message); }
        teaserFait = true;
      }

      const { error } = await supabase.from('sent_alerts').insert({
        alert_url: alerte.url,
        alert_title: alerte.title,
        source: alerte.source,
        recipients: envoyes,
        created_at: new Date().toISOString()
      });
      if (error) console.error('[cyber-alerts] insertion sent_alerts:', error.message);

      total += envoyes;
    }

    console.log(`[cyber-alerts] ${candidates.length} alerte(s), ${total} email(s)`);
    return { statusCode: 200, body: JSON.stringify({ alerts: candidates.length, emails: total }) };

  } catch (err) {
    console.error('[cyber-alerts] erreur:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
