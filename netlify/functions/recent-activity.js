// ════════════════════════════════════════════
// DESPY — Activité récente d'un utilisateur
// Agrège les évènements horodatés (analyses, quiz,
// signalements, vérif. fuites) pour le fil d'accueil de l'app.
// Lecture seule, aucune donnée personnelle d'autrui.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }
    const e = email.toLowerCase().trim();
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const items = [];

    // Analyses de messages / liens
    try {
      const { data: analyses } = await supabase
        .from('analyses_history')
        .select('verdict, score, content, created_at')
        .eq('email', e)
        .order('created_at', { ascending: false })
        .limit(6);
      (analyses || []).forEach(a => items.push({
        type: 'analyse',
        verdict: a.verdict || 'suspicious',
        score: typeof a.score === 'number' ? a.score : null,
        snippet: (a.content || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        ts: a.created_at
      }));
    } catch (e1) { /* table absente : on ignore */ }

    // Quiz / défis
    try {
      const { data: quizzes } = await supabase
        .from('quiz_history')
        .select('quiz_titre, score, total, created_at')
        .eq('email', e)
        .order('created_at', { ascending: false })
        .limit(3);
      (quizzes || []).forEach(q => items.push({
        type: 'quiz',
        title: q.quiz_titre || 'Quiz',
        score: q.score,
        total: q.total,
        ts: q.created_at
      }));
    } catch (e2) {}

    // Signalements de numéros
    try {
      const { data: phones } = await supabase
        .from('phone_reports')
        .select('phone, category, created_at')
        .eq('email', e)
        .order('created_at', { ascending: false })
        .limit(3);
      (phones || []).forEach(p => items.push({
        type: 'phone',
        phone: p.phone || '',
        category: p.category || '',
        ts: p.created_at
      }));
    } catch (e3) {}

    // Dernière vérification de fuites (dark web)
    try {
      const { data: client } = await supabase
        .from('clients')
        .select('last_hibp_check, breach_count')
        .eq('email', e)
        .maybeSingle();
      if (client && client.last_hibp_check) {
        items.push({
          type: 'hibp',
          breachCount: client.breach_count || 0,
          ts: client.last_hibp_check
        });
      }
    } catch (e4) {}

    items.sort((a, b) => new Date(b.ts) - new Date(a.ts));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ activity: items.slice(0, 8) })
    };

  } catch (err) {
    console.error('recent-activity error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
