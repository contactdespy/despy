// ════════════════════════════════════════════
// DESPY — Historique des vérifications d'un client
// Renvoie les analyses (SMS/email/lien) faites par le compte connecté,
// depuis la table analyses_history. Authentifié (jeton signé).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { email } = body;
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }
    // Authentification : le jeton doit correspondre à cet email
    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const norm = email.toLowerCase().trim();

    const { data, error } = await supabase
      .from('analyses_history')
      .select('content, verdict, score, created_at')
      .eq('email', norm)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('get-history query error:', error.message);
      return { statusCode: 200, headers, body: JSON.stringify({ items: [] }) };
    }

    // Nettoyage : on tronque le contenu pour l'affichage (pas de données lourdes)
    const items = (data || []).map(r => ({
      content: (r.content || '').toString().slice(0, 140),
      verdict: r.verdict || 'suspicious',
      score: r.score || 0,
      created_at: r.created_at
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ items }) };
  } catch (err) {
    console.error('get-history error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
