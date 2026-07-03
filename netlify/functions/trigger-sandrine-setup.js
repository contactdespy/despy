// ════════════════════════════════════════════
// DESPY — TEMPORAIRE : remise à plat du dossier Privacy Cleanup de la
// cliente activée avant la mise en place des tables. À SUPPRIMER après.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const KEY = '4ef657b1350a64719d7545c5';
const EMAIL = 'sandrinebouazzaoui000@gmail.com';
const CLIENT = {
  user_email: EMAIL, prenom: 'Sandrine', nom: 'Bouazzaoui Hoerth',
  target_email: EMAIL, phone: '06 19 40 34 85', ville: 'Strasbourg'
};

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).k !== KEY) return { statusCode: 404, body: 'Not found' };
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const steps = {};

  // 1. Fiche de demande (upsert) — pour que son espace soit "actif"
  try {
    // pas de contrainte unique garantie sur user_email : on nettoie puis on insère
    await supabase.from('privacy_requests').delete().eq('user_email', EMAIL);
    const { error } = await supabase.from('privacy_requests').insert({
      ...CLIENT, status: 'in_progress',
      notes: 'Cliente pré-automate — dossier reconstruit',
      activated_at: '2026-07-01T00:00:00.000Z'
    });
    steps.request = error ? 'ERR ' + error.message : 'ok';
  } catch (e) { steps.request = 'ERR ' + e.message; }

  // 2. Journal des 3 demandes RGPD déjà envoyées (sans les renvoyer)
  try {
    await supabase.from('privacy_dispatch_log').delete().eq('user_email', EMAIL);
    const brokers = [
      { broker_id: 'solocal', broker_name: 'PagesJaunes / PagesBlanches (Solocal)' },
      { broker_id: '118218', broker_name: '118218 — Le Numéro' },
      { broker_id: '118000', broker_name: '118000.fr' }
    ];
    const { error } = await supabase.from('privacy_dispatch_log').insert(
      brokers.map(b => ({ user_email: EMAIL, broker_id: b.broker_id, broker_name: b.broker_name, status: 'sent' }))
    );
    steps.dispatch_log = error ? 'ERR ' + error.message : 'ok (3)';
  } catch (e) { steps.dispatch_log = 'ERR ' + e.message; }

  // 3. Nettoyer les trouvailles du premier scan (repartir propre)
  try {
    const { error } = await supabase.from('privacy_findings').delete().eq('user_email', EMAIL);
    steps.findings_cleaned = error ? 'ERR ' + error.message : 'ok';
  } catch (e) { steps.findings_cleaned = 'ERR ' + e.message; }

  // 4. Relancer un scan propre → rapport avec boutons de validation
  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/privacy-scan-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify(CLIENT)
    });
    steps.scan = 'lancé (' + r.status + ')';
  } catch (e) { steps.scan = 'ERR ' + e.message; }

  return { statusCode: 200, body: JSON.stringify({ done: true, steps }) };
};
