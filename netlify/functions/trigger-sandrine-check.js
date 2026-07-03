// ════════════════════════════════════════════
// DESPY — TEMPORAIRE : lecture de contrôle du dossier Privacy Cleanup
// (ce que l'espace client affichera). Lecture seule. À SUPPRIMER après.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const KEY = '9278c2bbe5837516d8dad5dd';
const EMAIL = 'sandrinebouazzaoui000@gmail.com';

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).k !== KEY) return { statusCode: 404, body: 'Not found' };
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const out = {};

  const { data: req } = await supabase.from('privacy_requests').select('status, activated_at').eq('user_email', EMAIL).maybeSingle();
  out.fiche = req || 'absente';

  const { data: logs } = await supabase.from('privacy_dispatch_log').select('broker_name, status').eq('user_email', EMAIL);
  out.demandes_rgpd = (logs || []).map(l => `${l.broker_name} [${l.status}]`);

  const { data: finds } = await supabase.from('privacy_findings').select('title, category, action, status, confidence').eq('user_email', EMAIL).order('id');
  out.trouvailles = (finds || []).map(f => `${(f.title || '').slice(0, 55)} · ${f.category}/${f.action} · ${Math.round((f.confidence || 0) * 100)}% → ${f.status}`);

  out.visibles_par_la_cliente = (logs || []).length + (finds || []).filter(f => f.status === 'validated').length;

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
};
