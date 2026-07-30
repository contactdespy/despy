// ════════════════════════════════════════════
// DESPY — Le module du mois servi à l'appli
// POST { email } + jeton d'authentification
//
// Renvoie le dernier module PUBLIÉ (jamais un brouillon). Pour un compte
// gratuit, on renvoie seulement le titre + `locked:true` : il voit qu'il
// existe, ce qui donne une raison concrète de s'abonner, sans donner le contenu.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const email = (body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Connexion requise' }) };
  }
  const auth = requireAuth(event, body, email, headers);
  if (!auth.ok) return auth.response;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: mod, error } = await supabase
      .from('monthly_modules')
      .select('id, period, title, intro, questions')
      .eq('status', 'published')
      .order('period', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Table absente (migration pas encore passée) ou aucun module publié :
    // l'appli masque simplement la carte, rien ne casse.
    if (error || !mod) {
      return { statusCode: 200, headers, body: JSON.stringify({ module: null }) };
    }

    const { data: client } = await supabase
      .from('clients').select('subscribed').eq('email', email).maybeSingle();

    if (!(client && client.subscribed)) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ module: { period: mod.period, title: mod.title, locked: true } })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ module: mod }) };
  } catch (err) {
    console.error('monthly-module:', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ module: null }) };
  }
};
