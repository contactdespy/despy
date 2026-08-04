// ════════════════════════════════════════════
// DESPY — Vérification compte + login
// Vérifie email + mot de passe dans Supabase
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { issueToken, rateLimit } = require('./_auth');
const { couvertureFamille } = require('./_famille');

// Vérifie le mot de passe — compatible scrypt (nouveau) et SHA-256 (legacy)
function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return derived === hash;
  }
  // Fallback legacy SHA-256 sans sel
  return crypto.createHash('sha256').update(password).digest('hex') === stored;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, password } = JSON.parse(event.body || '{}');

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: client, error } = await supabase
      .from('clients')
      .select('email, name, prenom, nom, telephone, plan, subscribed, password_hash, created_at, questions_used')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error) {
      console.error('Supabase error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
    }

    const hasPassword = typeof password === 'string' && password.length > 0;

    // ── Cas 1 : connexion avec mot de passe ──
    if (hasPassword) {
      // Anti force brute : 10 tentatives / 10 min / IP
      if (!rateLimit(event, 'login', 10, 10 * 60 * 1000)) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' }) };
      }
      // Réponse identique que le compte existe ou non (anti-énumération)
      if (!client || !verifyPassword(password, client.password_hash)) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ exists: false, error: 'Email ou mot de passe incorrect' })
        };
      }
      // Un proche rattaché à une formule Famille n'a pas d'abonnement à son
      // nom : sa protection vient de celle du payeur. On l'accorde ici.
      const famC = client.subscribed ? { couvert: false }
                                     : await couvertureFamille(supabase, client.email);

      // Mot de passe valide → on renvoie les données personnelles
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          exists: true,
          token: issueToken(client.email),
          email: client.email,
          name: client.name,
          prenom: client.prenom,
          nom: client.nom,
          telephone: client.telephone,
          plan: famC.couvert ? 'family_member' : (client.plan || 'free'),
          subscribed: client.subscribed || famC.couvert,
          famille_de: famC.couvert ? famC.owner : null,
          created_at: client.created_at,
          questions_used: client.questions_used || 0
        })
      };
    }

    // ── Cas 2 : appel sans mot de passe (statut quota/abonnement uniquement) ──
    // On ne divulgue AUCUNE donnée personnelle (nom, téléphone, email…).
    if (!client) {
      return { statusCode: 200, headers, body: JSON.stringify({ exists: false }) };
    }
    const fam = client.subscribed ? { couvert: false }
                                  : await couvertureFamille(supabase, client.email);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        exists: true,
        plan: fam.couvert ? 'family_member' : (client.plan || 'free'),
        subscribed: client.subscribed || fam.couvert,
        questions_used: client.questions_used || 0
      })
    };

  } catch (err) {
    console.error('check-subscription error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur' })
    };
  }
};
