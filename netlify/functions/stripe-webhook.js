// ════════════════════════════════════════════
// DESPY — Stripe Webhook Handler
// Netlify Function : /.netlify/functions/stripe-webhook
// Active le compte Supabase après paiement confirmé
// ════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Clé service (pas anon) pour le webhook
);

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

  // ── Paiement réussi : abonnement créé ──
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email   = session.metadata?.despy_email;
    const name    = session.metadata?.despy_name || email?.split('@')[0];
    const plan    = session.subscription_data?.metadata?.despy_plan || 'monthly';

    if (email) {
      try {
        // 1. Créer/mettre à jour le client dans Supabase
        await supabase.from('clients').upsert({
          email,
          name,
          plan,
          subscribed: true,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });

        // 2. Enregistrer l'abonnement
        const endDate = plan === 'annual'
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          : new Date(Date.now() +  30 * 24 * 60 * 60 * 1000).toISOString();

        await supabase.from('subscriptions').upsert({
          email,
          plan,
          status: 'active',
          start_date: new Date().toISOString(),
          end_date: endDate,
          stripe_subscription_id: session.subscription,
        }, { onConflict: 'email' });

        console.log(`✅ Compte activé pour ${email} — plan ${plan}`);

        // Envoyer l'email de bienvenue automatiquement
        try {
          await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'welcome',
              data: { name, email, plan }
            })
          });
          console.log(`📧 Email de bienvenue envoyé à ${email}`);
        } catch (emailErr) {
          console.error('Email welcome error:', emailErr);
          // On ne bloque pas le webhook si l'email échoue
        }
      } catch (err) {
        console.error('Supabase error:', err);
      }
    }
  }

  // ── Abonnement annulé ──
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    const customerId   = subscription.customer;

    try {
      const customers = await stripe.customers.list({ limit: 1 });
      const customer  = await stripe.customers.retrieve(customerId);
      if (customer.email) {
        await supabase.from('clients').update({
          subscribed: false,
          updated_at: new Date().toISOString()
        }).eq('email', customer.email);

        await supabase.from('subscriptions').update({
          status: 'cancelled'
        }).eq('email', customer.email);

        console.log(`❌ Abonnement annulé pour ${customer.email}`);
      }
    } catch (err) {
      console.error('Cancel error:', err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
