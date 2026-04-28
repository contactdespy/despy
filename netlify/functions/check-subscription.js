// ════════════════════════════════════════════
// DESPY — Vérification abonnement actif
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ subscribed: false }) };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data } = await supabase
      .from('clients')
      .select('subscribed, plan')
      .eq('email', email)
      .single();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        subscribed: data?.subscribed === true,
        plan: data?.plan || 'free'
      })
    };

  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ subscribed: false, plan: 'free' }) };
  }
};
