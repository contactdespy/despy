// ════════════════════════════════════════════
// DESPY — Stripe Webhook Handler
// Événements gérés :
//   checkout.session.completed   → activation abonnement
//   customer.subscription.deleted → résiliation
//   invoice.payment_failed        → email paiement échoué
//   invoice.payment_succeeded     → renouvellement
// ════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// ── Meta Conversions API : achat confirmé côté serveur ──
// Fiable même si le navigateur a un bloqueur de pub. Dédupliqué avec le
// pixel via event_id = id de session Stripe. Soumis au consentement
// marketing transmis dans les metadata du checkout (despy_consent).
async function sendMetaPurchase(email, sessionId, value) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token || !email) return;
  const em = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [{
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_id: sessionId,
          action_source: 'website',
          event_source_url: 'https://despy.fr',
          user_data: { em: [em] },
          custom_data: { value: value, currency: 'EUR' }
        }]
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) console.warn('Meta CAPI Purchase:', (await res.text()).substring(0, 200));
  } catch (e) { console.warn('Meta CAPI Purchase error:', e.message); }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendEmail(type, data) {
  try {
    await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify({ type, data })
    });
  } catch (e) {
    console.error(`Email ${type} error:`, e.message);
  }
}

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // ── Paiement réussi : activation abonnement ──
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email   = session.metadata?.despy_email;
    const name    = session.metadata?.despy_name || email?.split('@')[0] || '';
    const prenom  = name.split(' ')[0];
    const plan    = session.subscription_data?.metadata?.despy_plan || 'monthly';

    if (email) {
      const bonusUsed = parseInt(session.metadata?.despy_bonus_months_used || '0', 10) || 0;
      const baseDays = plan === 'annual' ? 365 : 30;
      const endDate = new Date(Date.now() + (baseDays + bonusUsed * 30) * 24 * 60 * 60 * 1000).toISOString();

      await supabase.from('clients').upsert({
        email,
        name,
        prenom,
        plan,
        subscribed: true,
        questions_used: 0,
        bonus_months: 0, // consommé par le trial Stripe
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email' });

      await supabase.from('subscriptions').upsert({
        email,
        plan,
        status: 'active',
        start_date: new Date().toISOString(),
        end_date: endDate,
        stripe_subscription_id: session.subscription,
      }, { onConflict: 'email' });

      console.log(`✅ Abonnement activé : ${email} — ${plan}`);
      await sendEmail('welcome', { email, name, prenom, plan });
      // Puis le mode d'emploi complet (guide de démarrage) — email séparé
      // pour que la confirmation reste courte et que le guide soit gardable.
      await sendEmail('welcome_guide', { email, name, prenom });

      // Conversion Meta serveur (si consentement marketing donné au checkout)
      if (session.metadata?.despy_consent === '1') {
        const PLAN_VALUE = { monthly: 9.99, annual: 89, family_monthly: 14.99, family_annual: 139 };
        await sendMetaPurchase(email, session.id, PLAN_VALUE[plan] || 9.99);
      }
    }
  }

  // ── Renouvellement réussi ──
  if (stripeEvent.type === 'invoice.payment_succeeded') {
    const invoice = stripeEvent.data.object;
    // Ignorer la première facture (déjà gérée par checkout.session.completed)
    if (invoice.billing_reason === 'subscription_create') return { statusCode: 200, body: '{}' };

    const customer = await stripe.customers.retrieve(invoice.customer);
    if (customer.email) {
      await supabase.from('clients').update({
        subscribed: true,
        updated_at: new Date().toISOString()
      }).eq('email', customer.email);

      console.log(`🔄 Renouvellement confirmé : ${customer.email}`);
    }
  }

  // ── Échec de paiement ──
  if (stripeEvent.type === 'invoice.payment_failed') {
    const invoice  = stripeEvent.data.object;
    const customer = await stripe.customers.retrieve(invoice.customer);

    if (customer.email) {
      console.log(`💳 Paiement échoué : ${customer.email}`);
      await sendEmail('payment_failed', {
        email:        customer.email,
        name:         customer.name || customer.email,
        attemptCount: invoice.attempt_count,
        invoiceUrl:   invoice.hosted_invoice_url
      });
    }
  }

  // ── Résiliation ──
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    const customer     = await stripe.customers.retrieve(subscription.customer);

    if (customer.email) {
      await supabase.from('clients').update({
        subscribed: false,
        plan: 'free',
        updated_at: new Date().toISOString()
      }).eq('email', customer.email);

      await supabase.from('subscriptions').update({
        status: 'cancelled'
      }).eq('email', customer.email);

      console.log(`❌ Résiliation : ${customer.email}`);
      await sendEmail('cancelled', { email: customer.email, name: customer.name || customer.email });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
