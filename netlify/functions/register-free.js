// ════════════════════════════════════════════
// DESPY — Inscription compte gratuit
// Crée un compte avec email + password (scrypt + sel)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Hachage sécurisé avec sel (scrypt)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
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
    const body = JSON.parse(event.body || '{}');
    const { email, password, prenom, nom, telephone, dob } = body;

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }
    if (!password || password.length < 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Mot de passe minimum 8 caractères' }) };
    }
    if (!prenom || !nom) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nom et prénom requis' }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Vérifier si email existe déjà
    const { data: existing } = await supabase
      .from('clients')
      .select('email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Un compte existe déjà avec cet email. Connectez-vous.' })
      };
    }

    const password_hash = hashPassword(password);

    const { data: newClient, error } = await supabase
      .from('clients')
      .insert([{
        email: email.toLowerCase().trim(),
        password_hash,
        prenom,
        nom,
        name: prenom + ' ' + nom,
        telephone: telephone || null,
        date_naissance: dob || null,
        plan: 'free',
        subscribed: false,
        lead: true
      }])
      .select()
      .single();

    if (error) {
      console.error('Insert error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erreur création compte' })
      };
    }

    // Envoyer email de bienvenue
    try {
      const baseUrl = process.env.URL || 'https://despy.fr';
      await fetch(`${baseUrl}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_SECRET || ''
        },
        body: JSON.stringify({
          type: 'welcome_free',
          data: { email, prenom, name: prenom + ' ' + nom }
        })
      });
    } catch (e) {
      console.error('Email error:', e);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        email,
        name: prenom + ' ' + nom,
        prenom,
        nom,
        plan: 'free'
      })
    };

  } catch (err) {
    console.error('register-free error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur' })
    };
  }
};
