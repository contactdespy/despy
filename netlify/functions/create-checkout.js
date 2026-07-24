// ════════════════════════════════════════════
// DESPY — Stripe Checkout Session Creator
// Netlify Function : /.netlify/functions/create-checkout
// ════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// IDs des produits Stripe (à créer dans le dashboard Stripe)
// stripe.com/dashboard → Products → Add product
const PRICE_IDS = {
  monthly:        process.env.STRIPE_PRICE_MONTHLY,         // solo mensuel — 9,99€
  annual:         process.env.STRIPE_PRICE_ANNUAL,          // solo annuel — 89€
  family_monthly: process.env.STRIPE_PRICE_FAMILY_MONTHLY,  // famille mensuel — 14,99€
  family_annual:  process.env.STRIPE_PRICE_FAMILY_ANNUAL,   // famille annuel — 139€
};

exports.handler = async (event, context) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, name, plan, source, marketing_consent } = JSON.parse(event.body || '{}');

    // Validation
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }
    if (!plan || !['monthly', 'annual', 'family_monthly', 'family_annual'].includes(plan)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Plan invalide' }) };
    }
    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Prix non configuré' }) };
    }

    // Déterminer les URLs de retour selon la source (site ou appli)
    const baseUrl = process.env.URL || 'https://despy.fr';
    // ⚠️ On vise /app (redirection 301 vers la version courante de l'appli), et
    // JAMAIS le nom de fichier versionné : il pointait encore vers
    // despy_app_v21.html, supprimé depuis — un client qui payait depuis l'appli
    // tombait sur une 404 juste après avoir réglé. La redirection conserve bien
    // les paramètres (vérifié en prod).
    const successUrl = source === 'app'
      ? `${baseUrl}/app?payment=success&session_id={CHECKOUT_SESSION_ID}`
      : `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = source === 'app'
      ? `${baseUrl}/app?payment=cancel`
      : `${baseUrl}?payment=cancel`;

    // Lire les bonus_months du compte (parrainage)
    let bonusMonths = 0;
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data: client } = await supabase
          .from('clients')
          .select('bonus_months')
          .eq('email', email.toLowerCase().trim())
          .maybeSingle();
        bonusMonths = Math.min(parseInt(client?.bonus_months || 0, 10) || 0, 24); // cap à 24 mois
      }
    } catch (e) {
      console.error('bonus_months lookup error:', e.message);
    }
    const trialDays = bonusMonths * 30;

    // Créer ou récupérer le customer Stripe
    let customerId;
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email,
        name: name || email.split('@')[0],
        metadata: { source: source || 'site', plan }
      });
      customerId = customer.id;
    }

    // Créer la session Checkout Stripe
    // Moyens de paiement proposés :
    //   • 'card'       → Carte bancaire (Visa, Mastercard, Amex…), Apple Pay, Google Pay
    //   • 'sepa_debit' → Prélèvement SEPA : le client donne son IBAN une fois,
    //                    puis prélèvement automatique chaque mois. PAS de double
    //                    authentification 3-D Secure → idéal pour les seniors.
    // ⚠️ IMPORTANT : 'sepa_debit' doit d'abord être ACTIVÉ dans le Dashboard Stripe
    //    (Réglages → Moyens de paiement → Prélèvement SEPA). Sans ça, Stripe
    //    rejette la création de session.
    // PayPal : activer dans le Dashboard puis ajouter 'paypal' ici.
    // ⚠️ Ne PAS combiner payment_method_types avec payment_method_configuration.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card', 'sepa_debit'],
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic',
        },
      },
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      locale: 'fr',
      allow_promotion_codes: true,
      subscription_data: Object.assign(
        {
          metadata: {
            despy_email: email,
            despy_name: name || '',
            despy_source: source || 'site',
            despy_plan: plan,
            despy_bonus_months_used: String(bonusMonths)
          }
        },
        trialDays > 0 ? { trial_period_days: trialDays } : {}
      ),
      metadata: {
        despy_email: email,
        despy_plan: plan,
        despy_source: source || 'site',
        despy_bonus_months_used: String(bonusMonths),
        despy_consent: marketing_consent ? '1' : '0'
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: session.url,
        sessionId: session.id,
        bonusMonthsApplied: bonusMonths,
        trialDays
      })
    };

  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur de paiement', details: err.message })
    };
  }
};
