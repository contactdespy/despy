// ════════════════════════════════════════════
// DESPY — Entraînement récurrent : envoi des tests surprise
// Cron quotidien (voir netlify.toml).
//
// Une formation se termine ; un entraînement, non. Ce cron envoie à intervalles
// choisis par le membre un faux message-test en conditions réelles — le seul
// exercice qui se répète indéfiniment et qui entretient vraiment le réflexe.
//
// Trois principes tenus :
//  1. OPT-IN STRICT : on n'envoie qu'à ceux qui ont activé l'entraînement.
//  2. VRAIE SURPRISE : une fois l'échéance atteinte, l'envoi part un jour au
//     hasard dans la semaine qui suit. Un test attendu à date fixe n'entraîne
//     à rien. (Sécurité : au-delà de 10 jours de retard, on envoie d'office
//     pour que le cycle ne dérive pas indéfiniment.)
//  3. JAMAIS DEUX FOIS LE MÊME : on évite les modèles déjà reçus récemment.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { isScheduled, notScheduled } = require('./_is-scheduled');
const { TEMPLATES } = require('./training-templates');

const JOURS = { mensuel: 30, bimestriel: 60, trimestriel: 90 };
const CHANCE_PAR_JOUR = 0.25;   // ≈ 4 jours d'attente en moyenne après l'échéance
const RETARD_MAX = 10;          // au-delà, on envoie sans tirer au sort

exports.handler = async (event) => {
  if (!isScheduled(event)) return notScheduled();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const base = process.env.URL || 'https://despy.fr';

  try {
    // Membres ayant activé l'entraînement (colonnes issues de la migration).
    const { data: membres, error } = await supabase
      .from('clients')
      .select('email, prenom, name, subscribed, training_active, training_rythme, training_last_at, trusted_contact_email, trusted_contact_name')
      .eq('training_active', true);

    if (error) {
      console.error('training-cycle: migration absente ?', error.message);
      return { statusCode: 200, body: JSON.stringify({ sent: 0, error: 'migration' }) };
    }
    if (!membres || !membres.length) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    // Désinscriptions globales à respecter
    const stop = new Set();
    try {
      const { data: outs } = await supabase.from('email_optouts').select('email');
      (outs || []).forEach(o => { if (o.email) stop.add(o.email.toLowerCase()); });
    } catch (e) { console.warn('optouts:', e.message); }

    const maintenant = Date.now();
    let envoyes = 0, ignores = 0, echecs = 0;

    for (const m of membres) {
      const email = (m.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) { ignores++; continue; }
      if (stop.has(email)) { ignores++; continue; }
      if (!m.subscribed) { ignores++; continue; }   // l'entraînement fait partie de l'abonnement

      const intervalle = JOURS[m.training_rythme] || 30;
      const depuis = m.training_last_at
        ? (maintenant - new Date(m.training_last_at).getTime()) / 86400000
        : intervalle;                                // jamais testé → éligible tout de suite
      const retard = depuis - intervalle;
      if (retard < 0) { ignores++; continue; }       // pas encore l'heure

      // La surprise : on ne part pas le jour exact de l'échéance.
      if (retard < RETARD_MAX && Math.random() > CHANCE_PAR_JOUR) { ignores++; continue; }

      // Choisir un modèle qu'il n'a pas eu récemment
      let recents = [];
      try {
        const { data: h } = await supabase
          .from('training_tests').select('template_id')
          .eq('email', email).order('sent_at', { ascending: false }).limit(4);
        recents = (h || []).map(x => x.template_id).filter(Boolean);
      } catch (e) {}
      let choix = TEMPLATES.filter(t => recents.indexOf(t.id) === -1);
      if (!choix.length) choix = TEMPLATES;
      const tpl = choix[Math.floor(Math.random() * choix.length)];

      try {
        const r = await fetch(`${base}/.netlify/functions/training-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
          body: JSON.stringify({
            email,
            prenom: m.prenom || (m.name || '').split(' ')[0] || '',
            templateId: tpl.id,
            trustedEmail: m.trusted_contact_email || '',
            trustedName: m.trusted_contact_name || ''
          })
        });
        if (!r.ok) { echecs++; console.error('training-send', email, r.status); continue; }

        await supabase.from('clients')
          .update({ training_last_at: new Date().toISOString() })
          .eq('email', m.email);
        envoyes++;
        await new Promise(res => setTimeout(res, 400));   // douceur délivrabilité
      } catch (e) {
        echecs++;
        console.error('training-cycle', email, e.message);
      }
    }

    console.log(`training-cycle : ${envoyes} tests envoyés, ${ignores} ignorés, ${echecs} échecs`);
    return { statusCode: 200, body: JSON.stringify({ sent: envoyes, skipped: ignores, failed: echecs }) };
  } catch (err) {
    console.error('training-cycle error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
