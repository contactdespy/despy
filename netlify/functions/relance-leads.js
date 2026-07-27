// ════════════════════════════════════════════
// DESPY — Relance leads J+3
// Cron : tous les jours à 10h → 0 10 * * *
// Relance les comptes gratuits créés il y a 3 jours
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement (pas d'appel HTTP)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Leads créés il y a exactement 3 jours (fenêtre de 24h)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const start = new Date(threeDaysAgo);
    start.setHours(0, 0, 0, 0);
    const end = new Date(threeDaysAgo);
    end.setHours(23, 59, 59, 999);

    const { data: leads } = await supabase
      .from('clients')
      .select('email, name, prenom')
      .eq('subscribed', false)
      .eq('lead', true)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString());

    if (!leads || leads.length === 0) {
      console.log('Aucun lead à relancer aujourd\'hui');
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    let sent = 0;
    for (const lead of leads) {
      const prenom = lead.prenom || lead.name?.split(' ')[0] || 'cher membre';
      try {
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({
            type: 'relance_lead',
            data: { email: lead.email, name: lead.name, prenom }
          })
        });
        sent++;
      } catch (e) { console.error('Relance email error:', lead.email, e); }
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`Leads relancés: ${sent}`);
    return { statusCode: 200, body: JSON.stringify({ sent, total: leads.length }) };

  } catch (err) {
    console.error('Relance leads error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
