// ════════════════════════════════════════════
// DESPY — Stripe Checkout Session Creator
// Netlify Function : /.netlify/functions/create-checkout
// ════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// IDs des produits Stripe (à créer dans le dashboard Stripe)
// stripe.com/dashboard → Products → Add product
const PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY, // ex: price_1OxxxxxxxxxxxMONTHLY
  annual:  process.env.STRIPE_PRICE_ANNUAL,  // ex: price_1OxxxxxxxxxxxANNUAL
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
    const { email, name, plan, source } = JSON.parse(event.body || '{}');

    // Validation
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }
    if (!plan || !['monthly', 'annual'].includes(plan)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Plan invalide' }) };
    }
    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Prix non configuré' }) };
    }

    // Déterminer les URLs de retour selon la source (site ou appli)
    const baseUrl = process.env.URL || 'https://despy.fr';
    const successUrl = source === 'app'
      ? `${baseUrl}/despy_app_v21.html?payment=success&session_id={CHECKOUT_SESSION_ID}`
      : `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = source === 'app'
      ? `${baseUrl}/despy_app_v21.html?payment=cancel`
      : `${baseUrl}?payment=cancel`;

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
    // payment_method_types: 'automatic' laisse Stripe choisir les meilleurs
    // moyens de paiement disponibles selon le device et le pays du client
    // → Apple Pay sur iPhone/Safari, PayPal, CB, etc.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      // 'automatic' active Apple Pay, Google Pay, PayPal, CB selon le device
      // Plus besoin de lister manuellement — Stripe optimise automatiquement
      payment_method_types: ['card', 'paypal'],
      payment_method_options: {
        card: {
          // Activer Apple Pay / Google Pay via Stripe (wallet payments)
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
      // Activer les wallets (Apple Pay, Google Pay)
      payment_method_configuration: null, // Utilise la config par défaut du compte
      subscription_data: {
        metadata: {
          despy_email: email,
          despy_name: name || '',
          despy_source: source || 'site',
          despy_plan: plan
        }
      },
      metadata: {
        despy_email: email,
        despy_source: source || 'site'
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: session.url,
        sessionId: session.id
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
