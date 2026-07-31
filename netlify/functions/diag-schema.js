// ════════════════════════════════════════════
// DESPY — SONDE TEMPORAIRE : les 3 migrations de juillet sont-elles passées ?
//
// ⚠ À SUPPRIMER dès la vérification faite. Protégée par un jeton à usage
// unique. Ne renvoie QUE des booléens « la colonne/table existe ou non » —
// aucune donnée personnelle, aucun comptage, aucun contenu.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const JETON = '82d0c96de47fc4faa2e9bc11ebe0bdbd';

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const q = event.queryStringParameters || {};
  if (q.t !== JETON) return { statusCode: 403, headers, body: JSON.stringify({ error: 'non autorisé' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const res = {};

  // On demande la colonne avec limit 0 : si elle manque, Supabase renvoie une erreur.
  async function colonne(table, cols) {
    try {
      const { error } = await supabase.from(table).select(cols).limit(0);
      return !error;
    } catch (e) { return false; }
  }

  res.chat_quota    = await colonne('clients', 'chat_period, chat_period_used');
  res.entrainement  = await colonne('clients', 'training_active, training_rythme, training_last_at');
  res.arnaque_mois  = await colonne('monthly_modules', 'id, period, status');

  res.toutes_ok = res.chat_quota && res.entrainement && res.arnaque_mois;
  return { statusCode: 200, headers, body: JSON.stringify(res) };
};
