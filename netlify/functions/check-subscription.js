// ════════════════════════════════════════════
// DESPY — Vérification compte + login
// Vérifie email + mot de passe dans Supabase
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Vérifie le mot de passe — compatible scrypt (nouveau) et SHA-256 (legacy)
function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return derived === hash;
  }
  // Fallback legacy SHA-256 sans sel
  return crypto.createHash('sha256').update(password).digest('hex') === stored;
}

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
    const { email, password } = JSON.parse(event.body || '{}');

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: client, error } = await supabase
      .from('clients')
      .select('email, name, prenom, nom, telephone, plan, subscribed, password_hash, created_at')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error) {
      console.error('Supabase error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
    }

    // Réponse identique que le compte existe ou non (anti-énumération)
    if (!client || (password && !verifyPassword(password, client.password_hash))) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ exists: false, error: 'Email ou mot de passe incorrect' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        exists: true,
        email: client.email,
        name: client.name,
        prenom: client.prenom,
        nom: client.nom,
        telephone: client.telephone,
        plan: client.plan || 'free',
        subscribed: client.subscribed || false,
        created_at: client.created_at
      })
    };

  } catch (err) {
    console.error('check-subscription error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur' })
    };
  }
};
