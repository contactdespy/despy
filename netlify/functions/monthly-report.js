// ════════════════════════════════════════════
// DESPY — Rapport mensuel personnalisé
// Cron : 1er du mois à 9h → 0 9 1 * *
// Envoie un récap réel par membre : analyses, fuites, quizzes
//
// Parti le 1er, il porte sur le mois ÉCOULÉ, et il en porte le nom. Il
// s'intitulait du mois qui commence (« novembre » pour les chiffres
// d'octobre) et disait « ce mois-ci » : il avait l'air en retard d'un mois.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { avecProches } = require('./_famille');
const { natureAlerte } = require('./_repere');

// L'encadré « Arnaque du mois » répétait la même phrase écrite en dur depuis
// le premier envoi. On y met la dernière alerte réellement publiée pendant le
// mois écoulé, nommée pour ce qu'elle est — ou rien, s'il n'y en a pas eu.
function choisirAlerteDuMois(alertes, debut, fin, mois) {
  const dans = (Array.isArray(alertes) ? alertes : []).filter(a => {
    const t = a && a.created_at ? new Date(a.created_at).toISOString() : '';
    return t >= debut && t < fin && a.title;
  }).sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
  if (!dans.length) return null;
  const a = dans[0];
  const nature = natureAlerte(a.source);
  const corps = String(a.body || '').replace(/\s+/g, ' ').trim();
  return {
    etiquette: (nature === 'vague' ? 'Détecté chez les membres Despy'
      : nature === 'saison' ? 'Arnaque de saison' : 'Repéré par Despy') + (mois ? ' en ' + mois : ''),
    title: a.title,
    body: corps.length > 240 ? corps.slice(0, 239).replace(/\s+\S*$/, '') + '…' : corps
  };
}
exports.choisirAlerteDuMois = choisirAlerteDuMois;

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement (pas d'appel HTTP)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: payeurs } = await supabase
      .from('clients')
      .select('email, name, prenom, plan, subscribed, breach_count, quizzes_completed, analyses_count, questions_used, referral_code, bonus_months')
      .eq('subscribed', true);
    const clients = await avecProches(supabase, payeurs, 'email, name, prenom, plan, subscribed, breach_count, quizzes_completed, analyses_count, questions_used, referral_code, bonus_months');

    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    const now = new Date();
    const debutEcoule = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthName = debutEcoule.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const mois = debutEcoule.toLocaleDateString('fr-FR', { month: 'long' });
    const monthStart = debutEcoule.toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Les mêmes alertes que celles que l'appli affiche (list-alerts les filtre).
    let alerte = null;
    try {
      const r = await fetch(`${process.env.URL}/.netlify/functions/list-alerts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      alerte = choisirAlerteDuMois((await r.json()).alerts, monthStart, monthEnd, mois);
    } catch (e) { console.warn('[bilan mensuel] alertes indisponibles :', e.message); }

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
        arnaques: scamsBlocked || 0,
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
            data: { email: client.email, name: client.name, prenom, monthName, mois, stats, alerte }
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
