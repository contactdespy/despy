// ════════════════════════════════════════════
// DESPY — Inscription compte gratuit
// Crée un compte avec email + password (scrypt + sel)
// + génère un code de parrainage unique
// + accepte un code parrainage / promo en entrée
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

// Code 6 caractères, lisibles humains (pas de 0/O/1/I)
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function generateUniqueCode(supabase) {
  for (let i = 0; i < 8; i++) {
    const code = generateReferralCode();
    const { data } = await supabase
      .from('clients')
      .select('email')
      .eq('referral_code', code)
      .maybeSingle();
    if (!data) return code;
  }
  // Fallback ultra-rare : ajoute un suffixe temps
  return generateReferralCode() + Date.now().toString(36).slice(-2).toUpperCase();
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
    const { email, password, prenom, nom, telephone, dob, referralCode } = body;

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }
    if (!password || password.length < 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Mot de passe minimum 8 caractères' }) };
    }
    if (!prenom || !nom) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nom et prénom requis' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

    // Valider le code parrainage si fourni
    let referrer = null;
    let referralBonusApplied = false;
    const cleanCode = (referralCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (cleanCode.length >= 4) {
      const { data: ref } = await supabase
        .from('clients')
        .select('email, referral_code, bonus_months')
        .eq('referral_code', cleanCode)
        .maybeSingle();
      if (ref && ref.email !== email.toLowerCase().trim()) {
        referrer = ref;
      }
    }

    // Code parrainage unique pour le nouveau compte
    const newReferralCode = await generateUniqueCode(supabase);

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
        lead: true,
        referral_code: newReferralCode,
        referred_by: referrer ? referrer.referral_code : null,
        bonus_months: referrer ? 1 : 0
      }])
      .select()
      .single();

    if (error) {
      console.error('Insert error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur création compte' }) };
    }

    // Récompenser le parrain : +1 mois bonus
    if (referrer) {
      await supabase.from('clients').update({
        bonus_months: (referrer.bonus_months || 0) + 1,
        updated_at: new Date().toISOString()
      }).eq('email', referrer.email);
      referralBonusApplied = true;
    }

    // Email de bienvenue
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
        plan: 'free',
        referralCode: newReferralCode,
        referralBonusApplied,
        bonusMonths: referrer ? 1 : 0
      })
    };

  } catch (err) {
    console.error('register-free error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
