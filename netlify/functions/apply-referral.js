// ════════════════════════════════════════════
// DESPY — Appliquer un code parrainage / promo
// Pour un compte existant qui a oublié de saisir le code à l'inscription
// Restrictions : 1 fois par compte, pas son propre code
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
    const { email, code } = body;
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }

    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;
    const cleanCode = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (cleanCode.length < 4) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code invalide' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const norm = email.toLowerCase().trim();

    // Récupérer le client courant
    const { data: client } = await supabase
      .from('clients')
      .select('email, referral_code, referred_by, bonus_months, created_at')
      .eq('email', norm)
      .maybeSingle();

    if (!client) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Compte introuvable' }) };
    }

    // Refus : déjà utilisé un code
    if (client.referred_by) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vous avez déjà utilisé un code parrainage' }) };
    }

    // Refus : son propre code
    if (client.referral_code === cleanCode) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vous ne pouvez pas utiliser votre propre code' }) };
    }

    // Récupérer le parrain
    const { data: referrer } = await supabase
      .from('clients')
      .select('email, referral_code, bonus_months')
      .eq('referral_code', cleanCode)
      .maybeSingle();

    if (!referrer) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Code invalide ou expiré' }) };
    }

    // Appliquer : +1 mois pour les deux
    await supabase.from('clients').update({
      referred_by: cleanCode,
      bonus_months: (client.bonus_months || 0) + 1,
      updated_at: new Date().toISOString()
    }).eq('email', norm);

    await supabase.from('clients').update({
      bonus_months: (referrer.bonus_months || 0) + 1,
      updated_at: new Date().toISOString()
    }).eq('email', referrer.email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Code appliqué — vous gagnez 1 mois offert (et votre parrain aussi).',
        bonus_months: (client.bonus_months || 0) + 1
      })
    };

  } catch (err) {
    console.error('apply-referral error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
