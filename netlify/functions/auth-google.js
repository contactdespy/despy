// ════════════════════════════════════════════
// DESPY — Authentification Google (Sign in with Google)
// POST { credential } — JWT renvoyé par Google Identity Services
// 1. Vérifie le JWT
// 2. Crée le compte si nouveau, sinon login
// 3. Renvoie les infos pour la session frontend
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = '748335639234-oj6eijplnemcr23b6us3bohv2cannql4.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Code 6 caractères lisibles (pas de 0/O/1/I)
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
  return generateReferralCode() + Date.now().toString(36).slice(-2).toUpperCase();
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { credential, referralCode } = JSON.parse(event.body || '{}');
    if (!credential) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Credential manquant' }) };
    }

    // 1. Vérifier le JWT auprès de Google
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (e) {
      console.error('Google JWT verify failed:', e.message);
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentification Google invalide' }) };
    }

    const email = (payload.email || '').toLowerCase().trim();
    const emailVerified = !!payload.email_verified;
    const googleId = payload.sub;
    const givenName = (payload.given_name || '').trim();
    const familyName = (payload.family_name || '').trim();
    const fullName = (payload.name || (givenName + ' ' + familyName).trim() || email.split('@')[0]).trim();

    if (!email || !emailVerified) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email Google non vérifié' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 2. Chercher si compte existe déjà (par email)
    const { data: existing } = await supabase
      .from('clients')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      // Compte existant : on connecte, on lie le google_id si pas encore lié
      const update = { updated_at: new Date().toISOString() };
      if (!existing.google_id) update.google_id = googleId;
      try {
        await supabase.from('clients').update(update).eq('email', email);
      } catch (e) {
        // Si la colonne google_id n'existe pas encore, on ignore — pas bloquant
        console.warn('Update google_id failed (column may not exist):', e.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          isNew: false,
          email,
          name: existing.name || fullName,
          prenom: existing.prenom || givenName,
          nom: existing.nom || familyName,
          telephone: existing.telephone || '',
          subscribed: !!existing.subscribed,
          plan: existing.plan || 'free',
          created_at: existing.created_at,
          referralCode: existing.referral_code || null
        })
      };
    }

    // 3. Création nouveau compte via Google
    let referrer = null;
    let referralBonusApplied = false;
    const cleanCode = (referralCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (cleanCode.length >= 4) {
      const { data: ref } = await supabase
        .from('clients')
        .select('email, referral_code, bonus_months')
        .eq('referral_code', cleanCode)
        .maybeSingle();
      if (ref && ref.email !== email) referrer = ref;
    }

    const newReferralCode = await generateUniqueCode(supabase);

    const insertRow = {
      email,
      prenom: givenName,
      nom: familyName,
      name: fullName,
      plan: 'free',
      subscribed: false,
      lead: true,
      referral_code: newReferralCode,
      referred_by: referrer ? referrer.referral_code : null,
      bonus_months: referrer ? 1 : 0
    };
    // Tente d'ajouter google_id si la colonne existe
    try { insertRow.google_id = googleId; } catch(e) {}

    let { data: newClient, error } = await supabase
      .from('clients')
      .insert([insertRow])
      .select()
      .single();

    // Si la colonne google_id n'existe pas, on réessaye sans
    if (error && /google_id/i.test(error.message || '')) {
      delete insertRow.google_id;
      const retry = await supabase.from('clients').insert([insertRow]).select().single();
      newClient = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error('Insert error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur création compte' }) };
    }

    if (referrer) {
      await supabase.from('clients').update({
        bonus_months: (referrer.bonus_months || 0) + 1,
        updated_at: new Date().toISOString()
      }).eq('email', referrer.email);
      referralBonusApplied = true;
    }

    // Email de bienvenue (best-effort)
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
          data: { email, prenom: givenName, name: fullName, referralCode: newReferralCode }
        })
      });
    } catch (e) {
      console.error('Email error:', e.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        isNew: true,
        email,
        name: fullName,
        prenom: givenName,
        nom: familyName,
        telephone: '',
        subscribed: false,
        plan: 'free',
        created_at: new Date().toISOString(),
        referralCode: newReferralCode,
        referralBonusApplied,
        bonusMonths: referrer ? 1 : 0
      })
    };

  } catch (err) {
    console.error('auth-google error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
