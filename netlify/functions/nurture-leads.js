// ════════════════════════════════════════════
// DESPY — Mini-formation : nurture automatique des leads du guide PDF
// Cron quotidien (voir netlify.toml).
//
// Séquence sur ~8 jours, 4 emails (nurture_j2 → nurture_j8) :
//   étape 1 ~J+1 · étape 2 ~J+3 · étape 3 ~J+5 · étape 4 ~J+7
// (espacés de 2 jours). Chaque lead avance d'une étape par passage éligible.
//
// Garde-fous :
//   - respecte les désinscriptions (table email_optouts)
//   - n'écrit pas à ceux qui sont devenus membres (table clients)
//   - best-effort : ne casse pas si les colonnes/tables manquent
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const STEP_EMAIL = { 1: 'nurture_j2', 2: 'nurture_j4', 3: 'nurture_j6', 4: 'nurture_j8' };
const MAX_STEP = 4;

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Leads pas encore au bout de la séquence
    const { data: leads, error } = await supabase
      .from('guide_leads')
      .select('email, prenom, nurture_step, nurture_last_at, updated_at')
      .or('nurture_step.is.null,nurture_step.lt.' + MAX_STEP);

    if (error) {
      console.error('nurture: select guide_leads (migration manquante ?):', error.message);
      return { statusCode: 200, body: JSON.stringify({ sent: 0, error: 'select' }) };
    }
    if (!leads || leads.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    // 2. Sets d'exclusion : désinscrits + déjà membres
    const optedOut = new Set();
    try {
      const { data: outs } = await supabase.from('email_optouts').select('email');
      (outs || []).forEach(o => optedOut.add((o.email || '').toLowerCase()));
    } catch (e) { console.warn('nurture: optouts', e.message); }

    const members = new Set();
    try {
      const { data: cli } = await supabase.from('clients').select('email');
      (cli || []).forEach(c => members.add((c.email || '').toLowerCase()));
    } catch (e) { console.warn('nurture: clients', e.message); }

    const now = Date.now();
    let sent = 0, skipped = 0;

    for (const lead of leads) {
      const email = (lead.email || '').toLowerCase();
      if (!email) continue;
      if (optedOut.has(email) || members.has(email)) { skipped++; continue; }

      const step = lead.nurture_step || 0;
      if (step >= MAX_STEP) continue;

      // Anticipation : 1er email 1 jour après le guide, puis 1 email / 2 jours
      const anchor = new Date(lead.nurture_last_at || lead.updated_at || now).getTime();
      const ageDays = (now - anchor) / 86400000;
      const gapNeeded = step === 0 ? 1 : 2;
      if (ageDays < gapNeeded) continue;

      const nextStep = step + 1;
      const type = STEP_EMAIL[nextStep];
      const prenom = lead.prenom || 'cher membre';

      try {
        const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
          body: JSON.stringify({ type, data: { email, prenom } })
        });
        if (!r.ok) { console.error(`nurture send ${type} -> ${email}:`, r.status); continue; }

        await supabase.from('guide_leads')
          .update({ nurture_step: nextStep, nurture_last_at: new Date().toISOString() })
          .eq('email', email);
        sent++;
        console.log(`nurture ${type} -> ${email} (étape ${nextStep})`);
        await new Promise(res => setTimeout(res, 1200)); // douceur délivrabilité
      } catch (e) {
        console.error(`nurture error ${email}:`, e.message);
      }
    }

    console.log(`nurture-leads : ${sent} envoyés, ${skipped} ignorés (désinscrits/membres)`);
    return { statusCode: 200, body: JSON.stringify({ sent, skipped }) };
  } catch (err) {
    console.error('nurture-leads error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
