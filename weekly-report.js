// ════════════════════════════════════════════
// DESPY — Rapport hebdomadaire automatique
// Netlify Function : /.netlify/functions/weekly-report
// Déclenché chaque lundi à 9h par Netlify Scheduled Functions
// ════════════════════════════════════════════
// Dans netlify.toml, ajouter :
// [functions.weekly-report]
//   schedule = "0 9 * * 1"   ← chaque lundi à 9h

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Menaces de la semaine — à mettre à jour manuellement ou automatiser
const THREATS_OF_WEEK = [
  "Arnaque au faux conseiller bancaire en hausse — ils se font passer pour le Crédit Agricole et demandent un virement 'de sécurité'. Ne raccrochez pas poliment, raccrochez directement.",
  "Faux SMS de La Poste — lien de suivi de colis qui vole vos données bancaires. Passez votre curseur sur le lien avant de cliquer.",
  "Phishing Netflix en hausse — email 'Votre compte va être suspendu' avec fausse page de paiement. Netflix ne demande jamais ça par email.",
  "Arnaque CPF — démarchage téléphonique proposant une formation gratuite. Votre CPF peut être vidé sans votre accord explicite.",
  "Faux support Microsoft — pop-up qui dit que votre PC est infecté. Fermez simplement la fenêtre, ne rappelez pas le numéro affiché.",
];

exports.handler = async (event) => {
  console.log('🔄 Démarrage rapport hebdomadaire...');

  try {
    // Récupérer tous les abonnés actifs
    const { data: subscribers, error } = await supabase
      .from('clients')
      .select('email, name, xp, level, security_score, badges, streak, subscribed')
      .eq('subscribed', true);

    if (error) throw error;
    if (!subscribers || subscribers.length === 0) {
      console.log('Aucun abonné actif trouvé');
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    const threat = THREATS_OF_WEEK[Math.floor(Math.random() * THREATS_OF_WEEK.length)];
    const baseUrl = process.env.URL || 'https://despy.fr';
    let sent = 0;
    let errors = 0;

    // Envoyer les rapports en série (Resend limite à 10/sec)
    for (const sub of subscribers) {
      try {
        await fetch(`${baseUrl}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'weekly',
            data: {
              name:    sub.name || 'vous',
              email:   sub.email,
              score:   sub.security_score || 25,
              streak:  sub.streak || 0,
              badges:  (sub.badges || []).length,
              topThreat: threat,
            }
          })
        });
        sent++;
        // Petit délai pour respecter les limites d'API
        await new Promise(r => setTimeout(r, 120));
      } catch (err) {
        console.error(`Erreur email ${sub.email}:`, err.message);
        errors++;
      }
    }

    console.log(`✅ Rapports envoyés: ${sent}/${subscribers.length} (${errors} erreurs)`);
    return { statusCode: 200, body: JSON.stringify({ sent, errors, total: subscribers.length }) };

  } catch (err) {
    console.error('Weekly report error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
