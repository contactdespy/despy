// ════════════════════════════════════════════
// DESPY — Inscription compte gratuit
// Crée un compte avec email + password (hashé)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { email, password, prenom, nom, telephone, dob } = body;

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }
    if (!password || password.length < 4) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Mot de passe minimum 4 caractères' }) };
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

    // Hash du password
    const password_hash = crypto.createHash('sha256').update(password).digest('hex');

    // Créer le compte
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert([{
        email: email.toLowerCase().trim(),
        password_hash: password_hash,
        prenom: prenom,
        nom: nom,
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
      await fetch(`${process.env.URL || 'https://despy.fr'}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          template: 'welcome_free',
          data: { prenom: prenom }
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
        email: email,
        name: prenom + ' ' + nom,
        prenom: prenom,
        nom: nom,
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
