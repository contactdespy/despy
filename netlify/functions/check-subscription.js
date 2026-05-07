// ════════════════════════════════════════════
// DESPY — Vérification compte + login
// Vérifie email + mot de passe dans Supabase
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

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

    // Chercher le compte
    const { data: client, error } = await supabase
      .from('clients')
      .select('email, name, prenom, nom, telephone, plan, subscribed, password_hash, created_at')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error) {
      console.error('Supabase error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
    }

    // Compte n'existe pas
    if (!client) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ exists: false })
      };
    }

    // Si password fourni → vérifier
    if (password && client.password_hash) {
      // Hash simple (à remplacer par bcrypt en prod si besoin)
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(password).digest('hex');

      if (hash !== client.password_hash) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ exists: true, error: 'Mot de passe incorrect' })
        };
      }
    }

    // Retourner les infos du compte
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
