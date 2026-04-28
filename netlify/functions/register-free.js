// ════════════════════════════════════════════
// DESPY — Enregistrement compte gratuit
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
    const { email, name } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    await supabase.from('clients').upsert({
      email,
      name: name || email.split('@')[0],
      plan: 'free',
      subscribed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });

    console.log(`Compte gratuit créé: ${email}`);
    return { statusCode: 200, headers, body: JSON.stringify({ created: true }) };

  } catch (err) {
    console.error('Register free error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
