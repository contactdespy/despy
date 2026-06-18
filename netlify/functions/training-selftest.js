// ════════════════════════════════════════════
// DESPY — Auto-test d'entraînement anti-arnaque
// Permet à un utilisateur CONNECTÉ de s'envoyer un test à lui-même (sur son
// propre email). Authentifié (jeton signé) + rate limiting. Pas d'alerte au
// proche pour un auto-test. Le lien pointe uniquement vers /entrainement.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth, rateLimit } = require('./_auth');
const { byId, pickRandom, renderEmail } = require('./training-templates');

const sendResend = async (fromName, to, subject, html) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <contact@despy.fr>`, reply_to: 'contact@despy.fr', to: [to], subject, html })
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));
  return res.json();
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { email, templateId } = body;
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }
    // Authentification : le jeton doit correspondre à cet email
    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;

    // Anti-abus : 5 auto-tests / heure
    if (!rateLimit(event, 'selftest', 5, 60 * 60 * 1000)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de tests envoyés. Réessayez dans une heure.' }) };
    }

    const norm = email.toLowerCase().trim();
    const tpl = templateId ? byId(templateId) : pickRandom();
    if (!tpl) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Modèle inconnu' }) };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    // Prénom pour personnaliser le débrief (facultatif)
    let prenom = null;
    try {
      const { data: c } = await supabase.from('clients').select('prenom, name').eq('email', norm).maybeSingle();
      prenom = (c && (c.prenom || (c.name || '').split(' ')[0])) || null;
    } catch (e) {}

    const token = crypto.randomBytes(16).toString('hex');
    const link = `${process.env.URL || 'https://despy.fr'}/entrainement?t=${token}`;

    await supabase.from('training_tests').insert({
      token, email: norm, prenom, template_id: tpl.id, sent_at: new Date().toISOString()
    });

    await sendResend(tpl.brand, norm, tpl.subject, renderEmail(tpl, link));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, brand: tpl.brand, template: tpl.id }) };
  } catch (err) {
    console.error('training-selftest error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erreur serveur' }) };
  }
};
