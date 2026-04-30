// ════════════════════════════════════════════
// DESPY — Rapport mensuel personnalisé
// Cron : 1er du mois à 9h → 0 9 1 * *
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, prenom, plan, subscribed')
      .eq('subscribed', true);

    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    const now = new Date();
    const monthName = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    let sent = 0;

    for (const client of clients) {
      const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';
      try {
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'monthly_report',
            data: { email: client.email, name: client.name, prenom, monthName }
          })
        });
        sent++;
      } catch (e) { console.error('Email error:', client.email, e); }
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`Rapports envoyés: ${sent}`);
    return { statusCode: 200, body: JSON.stringify({ sent }) };

  } catch (err) {
    console.error('Monthly report error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
