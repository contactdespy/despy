// ════════════════════════════════════════════
// DESPY — Entraînement récurrent : réglages + historique du membre
// POST { email, action:'get'|'set', active?, rythme? } + jeton d'authentification
//
// Renvoie l'état de l'entraînement ET l'historique réel des tests reçus
// (table training_tests), pour que le membre VOIE sa progression — c'est ce
// qui donne envie de continuer. Opt-in strict : rien ne s'active tout seul.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

const RYTHMES = { mensuel: 30, bimestriel: 60, trimestriel: 90 };

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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // ── Écriture des réglages ──
    if (body.action === 'set') {
      const patch = {};
      if (typeof body.active === 'boolean') patch.training_active = body.active;
      if (body.rythme && RYTHMES[body.rythme]) patch.training_rythme = body.rythme;
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('clients').update(patch).eq('email', email);
        // Migration pas encore passée → on le dit franchement plutôt que de
        // laisser croire que c'est enregistré.
        if (error) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'migration_absente' }) };
        }
      }
    }

    // ── Lecture de l'état ──
    let actif = false, rythme = 'mensuel', dernier = null, dispo = true;
    let abonne = false;
    const res = await supabase
      .from('clients')
      .select('subscribed, training_active, training_rythme, training_last_at')
      .eq('email', email)
      .maybeSingle();

    if (res.error) {
      dispo = false;                                   // colonnes absentes
      const base = await supabase.from('clients').select('subscribed').eq('email', email).maybeSingle();
      abonne = !!(base.data && base.data.subscribed);
    } else if (res.data) {
      abonne = !!res.data.subscribed;
      actif = !!res.data.training_active;
      rythme = res.data.training_rythme || 'mensuel';
      dernier = res.data.training_last_at || null;
    }

    // ── Historique réel des tests ──
    let tests = [];
    try {
      const { data } = await supabase
        .from('training_tests')
        .select('template_id, sent_at, clicked_at')
        .eq('email', email)
        .order('sent_at', { ascending: false })
        .limit(12);
      tests = data || [];
    } catch (e) { console.warn('training-settings historique:', e.message); }

    const recus = tests.length;
    const pieges = tests.filter(t => t.clicked_at).length;

    // Prochaine échéance indicative (le cron ajoute une part de hasard :
    // un test attendu à date fixe ne serait plus une surprise).
    let prochain = null;
    if (actif) {
      const base = dernier ? new Date(dernier).getTime() : Date.now();
      prochain = new Date(base + (RYTHMES[rythme] || 30) * 86400000).toISOString();
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        disponible: dispo, abonne, actif, rythme,
        dernier, prochain,
        stats: { recus, pieges, evites: recus - pieges },
        tests
      })
    };
  } catch (err) {
    console.error('training-settings:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
