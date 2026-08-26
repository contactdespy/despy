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

    // Appliquer : +1 mois pour les deux.
    //
    // Ces deux écritures étaient lancées sans jamais lire la réponse de la
    // base, et le message « vous gagnez 1 mois offert (et votre parrain
    // aussi) » partait dans tous les cas. Un mois offert promis mais jamais
    // inscrit, c'est un mois facturé plus tard à quelqu'un à qui on avait dit
    // le contraire — et personne pour s'en apercevoir, puisque l'écran, lui,
    // disait que tout allait bien.
    //
    // L'ORDRE compte. C'est l'écriture du filleul qui pose `referred_by`, et
    // `referred_by` interdit toute seconde tentative (refus plus haut). Si
    // elle passait en premier et que celle du parrain ratait, le mois du
    // parrain serait perdu DÉFINITIVEMENT : plus aucun rejeu possible. On
    // crédite donc le parrain d'abord. Dans le pire des cas un rejeu lui offre
    // un mois de trop — c'est un cadeau, pas une promesse trahie.
    const rate = (quoi, e) => {
      console.error(`[parrainage] ÉCHEC ${quoi} :`, e.message);
      return { statusCode: 500, headers, body: JSON.stringify({
        error: 'Le code n\'a pas pu être appliqué. Réessayez dans un instant.' }) };
    };

    const { error: eParrain } = await supabase.from('clients').update({
      bonus_months: (referrer.bonus_months || 0) + 1,
      updated_at: new Date().toISOString()
    }).eq('email', referrer.email);
    if (eParrain) return rate('crédit du parrain', eParrain);

    const { error: eFilleul } = await supabase.from('clients').update({
      referred_by: cleanCode,
      bonus_months: (client.bonus_months || 0) + 1,
      updated_at: new Date().toISOString()
    }).eq('email', norm);
    if (eFilleul) return rate('crédit du filleul', eFilleul);

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
