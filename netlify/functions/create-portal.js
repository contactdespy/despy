// ════════════════════════════════════════════
// DESPY — Portail Client Stripe (Billing Portal)
// Netlify Function : /.netlify/functions/create-portal
//
// Ouvre le portail de facturation Stripe officiel pour un
// abonné CONNECTÉ. Le client peut y :
//   • changer de formule (mensuel → annuel, solo → famille…)
//     → Stripe gère le PRORATA automatiquement, pas de double
//       facturation
//   • mettre à jour sa carte / son IBAN
//   • télécharger ses factures
//   • résilier
//
// ⚠️ Prérequis Dashboard Stripe (une seule fois) :
//   Réglages → Facturation → Portail client → activer
//   « Les clients peuvent changer de formule » et cocher les
//   4 tarifs (mensuel, annuel, famille mensuel, famille annuel).
//
// Sécurité : endpoint AUTHENTIFIÉ. Le jeton signé (délivré à la
// connexion) doit correspondre à l'email réclamé — sinon 401.
// Sans ça, n'importe qui pourrait ouvrir le portail (donc voir
// factures + abonnement) d'un autre client avec juste son email.
// ════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').toLowerCase().trim();

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    // ── Authentification stricte : jeton ↔ email ──
    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;

    // ── Retrouver le customer Stripe ──
    // 1) via stripe_customer_id stocké dans Supabase (source fiable)
    // 2) fallback : recherche par email chez Stripe (abonnés d'avant
    //    l'enregistrement de la colonne)
    let customerId = null;

    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data: client } = await supabase
          .from('clients')
          .select('stripe_customer_id')
          .eq('email', email)
          .maybeSingle();
        if (client && client.stripe_customer_id) customerId = client.stripe_customer_id;
      } catch (e) {
        console.error('portal supabase lookup error:', e.message);
      }
    }

    if (!customerId) {
      const list = await stripe.customers.list({ email, limit: 1 });
      if (list.data.length > 0) customerId = list.data[0].id;
    }

    if (!customerId) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Aucun abonnement trouvé pour ce compte." })
      };
    }

    // ── Créer la session du portail ──
    // Le lien « Retour » de Stripe doit ramener LÀ D'OÙ l'on vient : dans
    // l'appli si l'appel vient de l'appli, sur le site sinon. Sans ça, un
    // membre de l'appli atterrissait sur la page d'accueil du site, sans
    // aucun chemin de retour vers l'appli.
    const baseUrl = process.env.URL || 'https://despy.fr';
    const returnUrl = body.source === 'app'
      ? `${baseUrl}/app?portal=return`
      : `${baseUrl}/?portal=return`;
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      locale: 'fr',
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };

  } catch (err) {
    console.error('create-portal error:', err);
    // Message explicite si le portail n'est pas encore configuré côté Stripe
    const details = err && err.message ? err.message : 'Erreur serveur';
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Impossible d'ouvrir la gestion de l'abonnement", details })
    };
  }
};
