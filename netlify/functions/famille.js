// ════════════════════════════════════════════
// DESPY — Offre Famille : inviter, accepter, retirer un proche
// POST { email, action } + jeton d'authentification
//   action 'etat'    → ce que voit le payeur ET le membre
//   action 'inviter' → crée un code (réservé au payeur d'une formule Famille)
//   action 'retirer' → révoque une invitation ou un membre
//   action 'accepter'→ un proche saisit son code et rejoint la famille
//
// Chaîne de confiance : le membre n'a jamais d'abonnement à son nom. Sa
// protection découle de celle du payeur et s'éteint avec elle (voir _famille).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth, rateLimit } = require('./_auth');
const { couvertureFamille, PLANS_FAMILLE, MAX_INVITES } = require('./_famille');

function nouveauCode() {
  // Lisible au téléphone : pas de 0/O ni 1/I, groupé par 3.
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += A[crypto.randomInt(A.length)];
  return c.slice(0, 3) + '-' + c.slice(3);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const email = (body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Connexion requise' }) };
  }
  const auth = requireAuth(event, body, email, headers);
  if (!auth.ok) return auth.response;

  if (!rateLimit(event, 'famille', 30, 10 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de demandes, réessayez plus tard.' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const action = body.action || 'etat';

  try {
    const { data: moi } = await supabase
      .from('clients').select('subscribed, plan, prenom, name').eq('email', email).maybeSingle();
    const estPayeur = !!(moi && moi.subscribed && PLANS_FAMILLE.includes(moi.plan));

    // ── Inviter un proche ──
    if (action === 'inviter') {
      if (!estPayeur) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'pas_famille' }) };
      }
      const { data: actuels, error: eL } = await supabase
        .from('family_members').select('id')
        .eq('owner_email', email).in('status', ['invited', 'active']);
      if (eL) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'migration_absente' }) };
      if ((actuels || []).length >= MAX_INVITES) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'complet' }) };
      }
      const code = nouveauCode();
      const { error } = await supabase.from('family_members')
        .insert({ owner_email: email, code, status: 'invited' });
      if (error) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'insert' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code }) };
    }

    // ── Retirer un proche (ou annuler une invitation) ──
    if (action === 'retirer') {
      if (!estPayeur) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'pas_famille' }) };
      const id = parseInt(body.id, 10);
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, raison: 'id' }) };
      await supabase.from('family_members')
        .update({ status: 'revoked' })
        .eq('id', id).eq('owner_email', email);      // on ne révoque QUE chez soi
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── Rejoindre une famille avec un code ──
    if (action === 'accepter') {
      const code = String(body.code || '').toUpperCase().replace(/\s/g, '');
      if (!code) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, raison: 'code_vide' }) };

      const { data: inv, error: eI } = await supabase
        .from('family_members').select('id, owner_email, status')
        .eq('code', code).maybeSingle();
      if (eI) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'migration_absente' }) };
      if (!inv || inv.status !== 'invited') {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'code_invalide' }) };
      }
      if (inv.owner_email === email) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'soi_meme' }) };
      }
      // Déjà rattaché ailleurs ?
      const dejaCouvert = await couvertureFamille(supabase, email);
      if (dejaCouvert.couvert) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'deja_membre' }) };
      }
      const { error } = await supabase.from('family_members')
        .update({ member_email: email, status: 'active', accepted_at: new Date().toISOString() })
        .eq('id', inv.id);
      if (error) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'deja_pris' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, owner: inv.owner_email }) };
    }

    // ── État (par défaut) ──
    let membres = [];
    let dispo = true;
    if (estPayeur) {
      const { data, error } = await supabase
        .from('family_members')
        .select('id, member_email, code, status, accepted_at')
        .eq('owner_email', email).in('status', ['invited', 'active'])
        .order('created_at', { ascending: true });
      if (error) dispo = false; else membres = data || [];
    }
    const couv = await couvertureFamille(supabase, email);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        disponible: dispo,
        estPayeur,
        plan: (moi && moi.plan) || 'free',
        places: MAX_INVITES,
        restantes: Math.max(0, MAX_INVITES - membres.length),
        membres,
        couvertPar: couv.couvert ? couv.owner : null
      })
    };
  } catch (err) {
    console.error('famille:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
