// ════════════════════════════════════════════
// DESPY — Stripe Webhook Handler v2
// Gère : paiement réussi, annulation, impayés
// ════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const sendEmail = async (type, data) => {
  try {
    await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    });
    console.log(`Email ${type} envoyé à ${data.email}`);
  } catch (err) {
    console.error(`Email ${type} erreur:`, err);
  }
};

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

  // ── 1. Paiement réussi : abonnement créé ──
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email   = session.metadata?.despy_email;
    const name    = session.metadata?.despy_name || email?.split('@')[0];
    const plan    = session.metadata?.despy_plan || 'monthly';

    if (email) {
      try {
        const endDate = plan === 'annual'
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          : new Date(Date.now() +  30 * 24 * 60 * 60 * 1000).toISOString();

        await supabase.from('clients').upsert({
          email, name, plan,
          subscribed: true,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });

        await supabase.from('subscriptions').upsert({
          email, plan, status: 'active',
          start_date: new Date().toISOString(),
          end_date: endDate,
          stripe_subscription_id: session.subscription,
        }, { onConflict: 'email' });

        console.log(`Compte activé: ${email} — plan ${plan}`);
        await sendEmail('welcome', { name, email, plan });

      } catch (err) {
        console.error('Supabase error:', err);
      }
    }
  }

  // ── 2. Abonnement annulé ──
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    try {
      const customer = await stripe.customers.retrieve(subscription.customer);
      if (customer.email) {
        await supabase.from('clients').update({
          subscribed: false,
          updated_at: new Date().toISOString()
        }).eq('email', customer.email);

        await supabase.from('subscriptions').update({
          status: 'cancelled'
        }).eq('email', customer.email);

        console.log(`Abonnement annulé: ${customer.email}`);
        await sendEmail('cancelled', { email: customer.email, name: customer.name || customer.email.split('@')[0] });
      }
    } catch (err) {
      console.error('Cancel error:', err);
    }
  }

  // ── 3. Paiement échoué — email de relance ──
  if (stripeEvent.type === 'invoice.payment_failed') {
    const invoice = stripeEvent.data.object;
    try {
      const customer = await stripe.customers.retrieve(invoice.customer);
      const email = customer.email;
      const name  = customer.name || email?.split('@')[0];

      // Compter les tentatives
      const attemptCount = invoice.attempt_count || 1;

      if (email) {
        await supabase.from('clients').update({
          payment_failed: true,
          payment_failed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('email', email);

        console.log(`Paiement échoué (tentative ${attemptCount}): ${email}`);
        await sendEmail('payment_failed', { email, name, attemptCount, invoiceUrl: invoice.hosted_invoice_url });
      }
    } catch (err) {
      console.error('Payment failed error:', err);
    }
  }

  // ── 4. Paiement récupéré après relance ──
  if (stripeEvent.type === 'invoice.payment_succeeded') {
    const invoice = stripeEvent.data.object;
    // Ignorer la première facture (déjà gérée par checkout.session.completed)
    if (invoice.billing_reason === 'subscription_cycle') {
      try {
        const customer = await stripe.customers.retrieve(invoice.customer);
        if (customer.email) {
          await supabase.from('clients').update({
            subscribed: true,
            payment_failed: false,
            updated_at: new Date().toISOString()
          }).eq('email', customer.email);

          console.log(`Renouvellement OK: ${customer.email}`);
        }
      } catch (err) {
        console.error('Renewal error:', err);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
