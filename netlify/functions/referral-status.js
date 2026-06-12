// ════════════════════════════════════════════
// DESPY — Statut parrainage d'un client
// Renvoie : code, parrainages réussis, mois bonus
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

    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const norm = email.toLowerCase().trim();

    const { data: client } = await supabase
      .from('clients')
      .select('referral_code, referred_by, bonus_months, subscribed, plan')
      .eq('email', norm)
      .maybeSingle();

    if (!client) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Compte introuvable' }) };
    }

    // Compter les parrainages réussis (clients ayant utilisé ce code)
    let referralCount = 0;
    if (client.referral_code) {
      const { count } = await supabase
        .from('clients')
        .select('email', { count: 'exact', head: true })
        .eq('referred_by', client.referral_code);
      referralCount = count || 0;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        referral_code: client.referral_code || null,
        referred_by: client.referred_by || null,
        bonus_months: client.bonus_months || 0,
        referral_count: referralCount,
        subscribed: !!client.subscribed,
        share_url: client.referral_code ? `https://despy.fr/?ref=${client.referral_code}` : null
      })
    };

  } catch (err) {
    console.error('referral-status error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
