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

// Retrouve notre plan interne à partir de l'ID de prix Stripe.
// Sert au changement de formule via le Portail Client (subscription.updated).
function planFromPriceId(priceId) {
  if (!priceId) return null;
  const map = {};
  if (process.env.STRIPE_PRICE_MONTHLY)        map[process.env.STRIPE_PRICE_MONTHLY]        = 'monthly';
  if (process.env.STRIPE_PRICE_ANNUAL)         map[process.env.STRIPE_PRICE_ANNUAL]         = 'annual';
  if (process.env.STRIPE_PRICE_FAMILY_MONTHLY) map[process.env.STRIPE_PRICE_FAMILY_MONTHLY] = 'family_monthly';
  if (process.env.STRIPE_PRICE_FAMILY_ANNUAL)  map[process.env.STRIPE_PRICE_FAMILY_ANNUAL]  = 'family_annual';
  return map[priceId] || null;
}

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

// Note l'échec (ou sa disparition) sur la fiche client. La colonne peut ne
// pas exister si la migration n'est pas passée : dans ce cas on ne casse
// SURTOUT pas le webhook — un paiement doit toujours être traité.
async function marquerPaiementEnDefaut(supabase, email, enDefaut) {
  try {
    const { error } = await supabase.from('clients').update({
      payment_issue_at: enDefaut ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('email', email);
    if (error) console.warn('paiement en défaut (migration manquante ?) :', error.message);
  } catch (e) {
    console.warn('paiement en défaut :', e && e.message);
  }
}

// Le client était-il déjà signalé en défaut ? Sert de filet quand Stripe ne
// précise pas la raison de la suppression de l'abonnement.
async function etaitEnDefaut(supabase, email) {
  try {
    const { data } = await supabase.from('clients')
      .select('payment_issue_at').eq('email', email).maybeSingle();
    return !!(data && data.payment_issue_at);
  } catch (e) { return false; }
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

  // ── Les écritures que le client a payées ────────────────────────────────
  // Elles étaient lancées sans jamais lire la réponse de la base. Une seule
  // qui rate en silence et le client devient un abonné fantôme : débité chez
  // Stripe, « compte gratuit » chez nous — et prévenu de rien, puisque l'email
  // de bienvenue, lui, part quand même. Personne ne s'en apercevrait avant sa
  // réclamation.
  //
  // Stripe REJOUE pendant 3 jours tout webhook qui ne répond pas 2xx. On s'en
  // sert comme filet : tant que la base n'a pas enregistré ce qui a été payé,
  // on refuse d'accuser réception, et Stripe revient frapper. Une panne
  // devient un retard qui se répare tout seul, au lieu d'une perte définitive.
  //
  // Les emails partent APRÈS les écritures, pour qu'un rejeu ne les double pas.
  const echecs = [];
  const ecrire = async (quoi, requete) => {
    const { error } = await requete;
    if (error) {
      console.error(`[stripe] ÉCHEC ${quoi} :`, error.message);
      echecs.push(`${quoi} : ${error.message}`);
      return false;
    }
    return true;
  };
  const redemander = () => {
    console.error('[stripe] webhook non acquitté — Stripe rejouera :', echecs.join(' | '));
    return { statusCode: 500, body: JSON.stringify({ error: 'base indisponible', echecs }) };
  };

  // ── Paiement réussi : activation abonnement ──
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email   = session.metadata?.despy_email;
    const name    = session.metadata?.despy_name || email?.split('@')[0] || '';
    const prenom  = name.split(' ')[0];
    const plan    = session.metadata?.despy_plan || session.subscription_data?.metadata?.despy_plan || 'monthly';

    if (email) {
      const bonusUsed = parseInt(session.metadata?.despy_bonus_months_used || '0', 10) || 0;
      const baseDays = plan === 'annual' ? 365 : 30;
      const endDate = new Date(Date.now() + (baseDays + bonusUsed * 30) * 24 * 60 * 60 * 1000).toISOString();

      // NB : password_hash n'est volontairement PAS dans cette charge — un
      // abonné qui a déjà choisi son mot de passe (set-initial-password peut
      // passer avant nous, la redirection est plus rapide que le webhook) ne
      // doit pas le voir écrasé. Un upsert ne touche que les colonnes citées.
      const fiche = {
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
      };
      // Téléphone et date de naissance saisis au formulaire d'abonnement.
      if (session.metadata?.despy_tel) fiche.telephone = session.metadata.despy_tel;
      if (session.metadata?.despy_dob) fiche.date_naissance = session.metadata.despy_dob;

      const { error: eFiche } = await supabase.from('clients').upsert(fiche, { onConflict: 'email' });
      if (eFiche) {
        // Une colonne optionnelle absente ne doit pas faire échouer
        // l'activation de l'abonnement : on rejoue sans les champs annexes.
        // Ce repli, lui, n'a plus le droit d'échouer en silence.
        delete fiche.telephone; delete fiche.date_naissance;
        console.warn('webhook clients upsert (repli sans tel/dob):', eFiche.message);
        await ecrire('activation de la fiche client',
          supabase.from('clients').upsert(fiche, { onConflict: 'email' }));
      }

      await ecrire('enregistrement de l\'abonnement',
        supabase.from('subscriptions').upsert({
          email,
          plan,
          status: 'active',
          start_date: new Date().toISOString(),
          end_date: endDate,
          stripe_subscription_id: session.subscription,
        }, { onConflict: 'email' }));

      // Avant les emails : un rejeu ne doit pas envoyer deux fois la bienvenue.
      if (echecs.length) return redemander();

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
      // Sans lecture de l'erreur, un renouvellement encaissé mais non écrit
      // faisait retomber un abonné en « compte gratuit » du jour au lendemain.
      if (!await ecrire('renouvellement', supabase.from('clients').update({
        subscribed: true,
        updated_at: new Date().toISOString()
      }).eq('email', customer.email))) return redemander();
      // Le paiement est passé : on retire le signalement s'il y en avait un.
      await marquerPaiementEnDefaut(supabase, customer.email, false);

      console.log(`🔄 Renouvellement confirmé : ${customer.email}`);
    }
  }

  // ── Échec de paiement ──
  if (stripeEvent.type === 'invoice.payment_failed') {
    const invoice  = stripeEvent.data.object;
    const customer = await stripe.customers.retrieve(invoice.customer);

    if (customer.email) {
      console.log(`💳 Paiement échoué : ${customer.email}`);
      // On l'écrit AVANT l'email : c'est cette trace qui permettra au site
      // et à l'application d'afficher le bandeau. L'email, lui, peut ne
      // jamais être lu — le public a 75 ans en moyenne.
      await marquerPaiementEnDefaut(supabase, customer.email, true);
      await sendEmail('payment_failed', {
        email:        customer.email,
        name:         customer.name || customer.email,
        attemptCount: invoice.attempt_count,
        invoiceUrl:   invoice.hosted_invoice_url
      });
    }
  }

  // ── Changement de formule (via le Portail Client Stripe) ──
  // Le client passe de mensuel → annuel, solo → famille, etc. Stripe
  // émet subscription.updated. On resynchronise le plan en base (sinon
  // l'appli afficherait l'ancienne formule) et on livre le livret si le
  // passage se fait vers un plan annuel (cohérent avec la promo).
  if (stripeEvent.type === 'customer.subscription.updated') {
    const subscription = stripeEvent.data.object;
    const priceId = subscription.items?.data?.[0]?.price?.id;
    const newPlan = planFromPriceId(priceId);

    if (newPlan) {
      const customer = await stripe.customers.retrieve(subscription.customer);
      if (customer.email) {
        const email  = customer.email;
        const active = subscription.status === 'active' || subscription.status === 'trialing';

        // Le statut, lui, change SANS que la formule bouge : c'est le cas
        // d'un impayé (past_due, unpaid). L'ancien code ne regardait que la
        // formule, donc n'en savait jamais rien.
        if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
          await marquerPaiementEnDefaut(supabase, email, true);
        } else if (active) {
          await marquerPaiementEnDefaut(supabase, email, false);
        }

        // Plan actuel en base → détecter un vrai changement de formule
        const { data: existing } = await supabase
          .from('clients').select('plan').eq('email', email).maybeSingle();
        const oldPlan = existing?.plan;

        if (oldPlan !== newPlan) {
          await ecrire('changement de formule (fiche client)',
            supabase.from('clients').update({
              plan: newPlan,
              subscribed: active,
              updated_at: new Date().toISOString()
            }).eq('email', email));

          await ecrire('changement de formule (abonnement)',
            supabase.from('subscriptions').update({
              plan: newPlan,
              status: active ? 'active' : subscription.status
            }).eq('email', email));

          if (echecs.length) return redemander();

          console.log(`♻️ Formule mise à jour : ${email} — ${oldPlan || '?'} → ${newPlan}`);

          // Livret offert si passage vers un plan annuel (cadeau promo)
          const isAnnual = newPlan === 'annual' || newPlan === 'family_annual';
          const wasAnnual = oldPlan === 'annual' || oldPlan === 'family_annual';
          if (isAnnual && !wasAnnual) {
            const name   = customer.name || email.split('@')[0];
            const prenom = name.split(' ')[0];
            await sendEmail('welcome', { email, name, prenom, plan: newPlan });
          }
        }
      }
    }
  }

  // ── Résiliation ──
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    const customer     = await stripe.customers.retrieve(subscription.customer);

    if (customer.email) {
      // POURQUOI l'abonnement s'arrête : Stripe le dit lui-même. À défaut,
      // la trace laissée par les échecs de paiement sert de filet.
      const raison = (subscription.cancellation_details && subscription.cancellation_details.reason) || '';
      const impaye = raison === 'payment_failed' || (!raison && await etaitEnDefaut(supabase, customer.email));

      await ecrire('fin d\'abonnement (fiche client)',
        supabase.from('clients').update({
          subscribed: false,
          plan: 'free',
          updated_at: new Date().toISOString()
        }).eq('email', customer.email));
      await marquerPaiementEnDefaut(supabase, customer.email, false);

      await ecrire('fin d\'abonnement (abonnement)',
        supabase.from('subscriptions').update({
          status: impaye ? 'unpaid' : 'cancelled'
        }).eq('email', customer.email));

      // Avant l'email : annoncer une résiliation qui n'a pas été enregistrée,
      // c'est promettre une chose et en faire une autre. Et au rejeu, le
      // membre recevrait deux fois le même adieu.
      if (echecs.length) return redemander();

      console.log(`❌ Fin d'abonnement (${impaye ? 'impayé' : 'résiliation'}) : ${customer.email}`);
      // Envoyer « votre résiliation est bien prise en compte » à quelqu'un
      // dont la carte a simplement expiré, c'est lui faire croire qu'on l'a
      // radié — et lui promettre un accès jusqu'à la fin d'une période qui,
      // justement, n'a pas été payée.
      await sendEmail(impaye ? 'subscription_ended_unpaid' : 'cancelled',
                      { email: customer.email, name: customer.name || customer.email });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
