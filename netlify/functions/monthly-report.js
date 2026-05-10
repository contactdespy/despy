// ════════════════════════════════════════════
// DESPY — Rapport mensuel personnalisé
// Cron : 1er du mois à 9h → 0 9 1 * *
// Envoie un récap réel par membre : analyses, fuites, quizzes
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, prenom, plan, subscribed, breach_count, quizzes_completed, analyses_count, questions_used, referral_code, bonus_months')
      .eq('subscribed', true);

    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    const now = new Date();
    const monthName = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let sent = 0;

    for (const client of clients) {
      const prenom = client.prenom || (client.name && client.name.split(' ')[0]) || 'cher membre';

      const { count: analysesMois } = await supabase
        .from('analyses_history')
        .select('id', { count: 'exact', head: true })
        .eq('email', client.email)
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd);

      const { count: scamsBlocked } = await supabase
        .from('analyses_history')
        .select('id', { count: 'exact', head: true })
        .eq('email', client.email)
        .eq('verdict', 'scam')
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd);

      const { count: quizzesMois } = await supabase
        .from('quiz_history')
        .select('id', { count: 'exact', head: true })
        .eq('email', client.email)
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd);

      const stats = {
        analyses: analysesMois || 0,
        scams_blocked: scamsBlocked || 0,
        quizzes: quizzesMois || 0,
        breaches: client.breach_count || 0,
        bonus_months: client.bonus_months || 0,
        referral_code: client.referral_code || ''
      };

      try {
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({
            type: 'monthly_report',
            data: { email: client.email, name: client.name, prenom, monthName, stats }
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
