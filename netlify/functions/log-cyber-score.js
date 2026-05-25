// ════════════════════════════════════════════
// DESPY — Log anonyme du score de cybersécurité
// POST { score, grade, answers }
// Best-effort : si la table n'existe pas, on retourne 200 sans erreur
// Analytics utile : score moyen, distribution, taux de complétion
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const score = Number(body.score) || 0;
    const grade = String(body.grade || '').slice(0, 4);
    const answers = body.answers || {};

    // Validation basique
    if (score < 0 || score > 1000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Score hors limites' }) };
    }

    // Tentative d'insertion Supabase — silencieusement OK si table absente
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        await supabase.from('cyber_scores').insert({
          score,
          grade,
          answers: typeof answers === 'object' ? answers : {},
          user_agent: event.headers['user-agent']?.slice(0, 200) || null,
          // Pas de stockage d'IP (RGPD) — analytics agrégés seulement
          created_at: new Date().toISOString()
        });
      } catch (e) {
        // Table absente ou colonnes incohérentes — best-effort, on ignore
        console.warn('[log-cyber-score] Supabase insert skipped:', e.message);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    // Best-effort total : même un parse error ne bloque pas le front
    console.error('[log-cyber-score] error:', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false }) };
  }
};
