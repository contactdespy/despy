// ════════════════════════════════════════════
// TEMPORAIRE — comptage des inscrits (agrégats uniquement, aucune donnée perso)
// À SUPPRIMER après usage. Protégé par un secret à usage unique.
// GET /.netlify/functions/stats-temp?k=<secret>
// ════════════════════════════════════════════
const { createClient } = require('@supabase/supabase-js');

const ONE_TIME = 'despy_stats_25631f82a2f86f428084ad66';

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.k !== ONE_TIME) return { statusCode: 404, body: 'Not found' };

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const out = {};

    // Total comptes
    const { count: total } = await supabase
      .from('clients').select('*', { count: 'exact', head: true });
    out.total_comptes = total;

    // Payants (subscribed = true)
    const { count: paid } = await supabase
      .from('clients').select('*', { count: 'exact', head: true }).eq('subscribed', true);
    out.comptes_payants = paid;
    out.comptes_gratuits = (total || 0) - (paid || 0);

    // Répartition par plan + inscrits récents (agrégé côté serveur)
    const { data: rows } = await supabase
      .from('clients').select('plan, subscribed, created_at');
    const byPlan = {};
    for (const r of rows || []) {
      const p = r.plan || 'free';
      byPlan[p] = (byPlan[p] || 0) + 1;
    }
    out.par_plan = byPlan;
    const c30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const c7  = new Date(Date.now() - 7 * 864e5).toISOString();
    out.inscrits_30j = (rows || []).filter(r => r.created_at && r.created_at >= c30).length;
    out.inscrits_7j  = (rows || []).filter(r => r.created_at && r.created_at >= c7).length;

    // Leads du guide gratuit (aimant à leads)
    try {
      const { count: leads } = await supabase
        .from('guide_leads').select('*', { count: 'exact', head: true });
      out.guide_leads = leads;
    } catch (e) { out.guide_leads = 'table absente'; }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
