// ════════════════════════════════════════════
// DESPY — Mot de passe initial d'un nouvel abonné
//
// Pourquoi cette fonction existe : le formulaire d'abonnement ne demande PAS
// de mot de passe (on ne veut pas ajouter de friction avant le paiement, le
// public est âgé). Le compte créé par le webhook Stripe n'en avait donc aucun
// — l'abonné payait puis restait dehors de l'appli, sans échappatoire.
//
// L'autorisation vient de Stripe, pas de nous : seul quelqu'un qui vient de
// terminer un paiement possède l'identifiant de session, et on redemande à
// Stripe que cette session est bien payée. On ne fait donc jamais confiance
// à l'email envoyé par le navigateur — c'est Stripe qui nous le donne.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { issueToken, rateLimit } = require('./_auth');

// Format identique à register-free.js — un seul format de hachage en base.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Un identifiant de session ne se devine pas, mais on borne quand même.
  if (!rateLimit(event, 'setpwd', 10, 15 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' }) };
  }

  try {
    const { session_id, password } = JSON.parse(event.body || '{}');

    if (!session_id || typeof session_id !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session de paiement manquante' }) };
    }
    if (!password || password.length < 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Mot de passe minimum 8 caractères' }) };
    }

    // ── L'autorisation : Stripe confirme que ce paiement a bien eu lieu ──
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id);
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session de paiement introuvable' }) };
    }
    const paye = session && (session.payment_status === 'paid' || session.status === 'complete');
    if (!paye) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Paiement non confirmé' }) };
    }

    const email = String(
      (session.customer_details && session.customer_details.email) ||
      (session.metadata && session.metadata.despy_email) || ''
    ).toLowerCase().trim();
    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email introuvable sur ce paiement' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: client } = await supabase
      .from('clients')
      .select('email, name, prenom, nom, telephone, plan, subscribed, password_hash, created_at')
      .eq('email', email)
      .maybeSingle();

    // Un mot de passe déjà défini ne doit JAMAIS être écrasé ici : sinon
    // rouvrir un vieux lien de confirmation permettrait de reprendre un
    // compte. Dans ce cas on renvoie vers « mot de passe oublié ».
    if (client && client.password_hash) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: false, raison: 'deja_defini' })
      };
    }

    // Le téléphone et la date de naissance saisis à l'inscription transitent
    // par la métadonnée Stripe : le webhook les pose, on complète ici si le
    // webhook n'est pas encore passé (la redirection est plus rapide que lui).
    const m = session.metadata || {};
    const maj = {
      email,
      password_hash: hashPassword(password),
      updated_at: new Date().toISOString()
    };
    if (!client || !client.telephone) {
      if (m.despy_tel) maj.telephone = m.despy_tel;
    }
    if (m.despy_dob) maj.date_naissance = m.despy_dob;
    if (m.despy_name && (!client || !client.name)) maj.name = m.despy_name;

    const { error } = await supabase
      .from('clients')
      .upsert(maj, { onConflict: 'email' });

    if (error) {
      // Si une colonne optionnelle manque, on réessaie sans elle plutôt que
      // de laisser l'abonné sans mot de passe — c'est lui la priorité.
      delete maj.date_naissance;
      const { error: e2 } = await supabase.from('clients').upsert(maj, { onConflict: 'email' });
      if (e2) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Enregistrement impossible' }) };
      }
    }

    // On le connecte dans la foulée : il vient de payer, lui redemander de
    // se connecter serait une marche de plus pour rien.
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ok: true,
        token: issueToken(email),
        email,
        name: (client && client.name) || m.despy_name || '',
        prenom: (client && client.prenom) || '',
        nom: (client && client.nom) || '',
        telephone: (client && client.telephone) || m.despy_tel || '',
        plan: (client && client.plan) || m.despy_plan || 'monthly',
        subscribed: client ? !!client.subscribed : true
      })
    };
  } catch (e) {
    console.error('set-initial-password:', e && e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
