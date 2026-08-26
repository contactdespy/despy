// ════════════════════════════════════════════
// DESPY — Surveillance de fond des fuites de données (HIBP)
// Cron : chaque lundi 7h → 0 7 * * 1 (voir netlify.toml)
//
// Cette fonction est PLANIFIÉE, donc injoignable en HTTP : Netlify renvoie un
// 403 vide au bord, avant même d'exécuter le code. Elle ne doit donc jamais
// servir de point d'entrée à l'appli — la vérification à la demande vit dans
// hibp-manuel.js, qui n'a pas de `schedule`.
//
// Toute la mécanique (appel HIBP, emails, push, cercle de confiance) est dans
// _hibp.js, partagé avec hibp-manuel.js pour qu'il n'existe qu'une définition.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const {
  checkEmailBreaches, buildBreachAlertHTML, alertTrustedContact, sendBreachPush
} = require('./_hibp');

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Boucle cron (tous les abonnés) : uniquement sur déclenchement planifié Netlify.
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();

  try {
    // Récupérer les abonnés actifs
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, prenom, last_hibp_check, known_breaches, trusted_contact_name, trusted_contact_email')
      .eq('subscribed', true);

    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ checked: 0, alerts: 0 }) };
    }

    let checked = 0;
    let alerts = 0;

    for (const client of clients) {
      const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';

      try {
        // Vérifier HIBP
        const breaches = await checkEmailBreaches(client.email);
        if (breaches === null) continue; // Erreur API, on passe

        // Trouver les nouvelles fuites depuis la dernière vérification
        const knownBreaches = client.known_breaches || [];
        const currentBreachNames = breaches.map(b => b.Name);
        const newBreaches = currentBreachNames.filter(n => !knownBreaches.includes(n));

        // Mettre à jour Supabase
        await supabase.from('clients').update({
          last_hibp_check: new Date().toISOString(),
          known_breaches: currentBreachNames,
          breach_count: breaches.length,
          updated_at: new Date().toISOString()
        }).eq('email', client.email);

        checked++;

        // Envoyer alerte si nouvelles fuites
        if (newBreaches.length > 0) {
          const html = buildBreachAlertHTML(prenom, client.email, breaches, newBreaches);

          await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-secret': process.env.INTERNAL_SECRET || ''
            },
            body: JSON.stringify({
              type: 'custom',
              data: {
                email: client.email,
                subject: `🚨 Despy — Vos données trouvées dans ${newBreaches.length} fuite${newBreaches.length > 1 ? 's' : ''}`,
                html
              }
            })
          });

          alerts++;
          console.log(`Alerte HIBP envoyée: ${client.email} — ${newBreaches.length} nouvelles fuites`);

          // Alerte push instantanée sur le téléphone (en plus de l'email)
          await sendBreachPush(client.email, newBreaches.length);

          // Cercle de confiance : alerter le proche désigné
          await alertTrustedContact(client, newBreaches.length);
        }

        // Pause entre chaque requête HIBP (rate limit = 1 req/1.5s)
        await new Promise(r => setTimeout(r, 1600));

      } catch(e) {
        console.error(`HIBP error for ${client.email}:`, e);
      }
    }

    console.log(`HIBP check: ${checked} vérifiés, ${alerts} alertes`);
    return {
      statusCode: 200,
      body: JSON.stringify({ checked, alerts })
    };

  } catch (err) {
    console.error('HIBP handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
