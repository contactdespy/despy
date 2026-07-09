// ════════════════════════════════════════════
// DESPY — TEMPORAIRE : état de la collecte de leads (guide PDF).
// Lecture seule. À SUPPRIMER après usage.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const KEY = '94921d7215db50f03a3eb914';

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).k !== KEY) return { statusCode: 404, body: 'Not found' };
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const out = {};

  // guide_leads : la table existe-t-elle ? combien de leads ?
  const { count, error } = await supabase.from('guide_leads').select('*', { count: 'exact', head: true });
  if (error) {
    out.guide_leads = 'TABLE ABSENTE ou inaccessible → ' + error.message;
  } else {
    out.guide_leads_total = count;
    const { data: recent } = await supabase.from('guide_leads').select('email, prenom, source, updated_at').order('updated_at', { ascending: false }).limit(5);
    out.derniers = (recent || []).map(r => `${r.email} (${r.prenom || '—'}) · ${r.source} · ${(r.updated_at||'').slice(0,10)}`);
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
};
