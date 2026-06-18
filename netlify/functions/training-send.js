// ════════════════════════════════════════════
// DESPY — Envoi d'un test d'entraînement anti-arnaque (opt-in)
// Déclenché par Despy (réglage utilisateur / cron / admin), JAMAIS public :
// protégé par INTERNAL_SECRET. N'envoie qu'à une personne ayant activé
// l'entraînement. Le lien du message pointe uniquement vers /entrainement.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { byId, pickRandom } = require('./training-templates');

const sendResend = async (fromName, to, subject, html) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    // Domaine vérifié Despy ; le nom d'affichage mime la marque pour le réalisme
    // du test (sensibilisation opt-in). Reply-To Despy.
    body: JSON.stringify({
      from: `${fromName} <contact@despy.fr>`,
      reply_to: 'contact@despy.fr',
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));
  return res.json();
};

// Met en forme le corps : remplace {{BUTTON:Label}} par un vrai bouton vers le lien
function renderBody(body, link) {
  const withButton = body.replace(/\{\{BUTTON:([^}]+)\}\}/g, (_, label) =>
    `<div style="text-align:center;margin:22px 0"><a href="${link}" style="display:inline-block;background:#2D5BFF;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">${label.trim()}</a></div>`
  );
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;font-size:15px;color:#222;line-height:1.6">${withButton}</div>`;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  // Accès interne uniquement
  const secret = process.env.INTERNAL_SECRET;
  if (secret && event.headers['x-internal-secret'] !== secret) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Accès non autorisé' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { email, prenom, templateId, trustedEmail, trustedName } = body;
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }

    const tpl = templateId ? byId(templateId) : pickRandom();
    if (!tpl) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Modèle inconnu' }) };

    const token = crypto.randomBytes(16).toString('hex');
    const baseUrl = process.env.URL || 'https://despy.fr';
    const link = `${baseUrl}/entrainement?t=${token}`;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('training_tests').insert({
      token,
      email: email.toLowerCase().trim(),
      prenom: (prenom || '').toString().slice(0, 60) || null,
      template_id: tpl.id,
      trusted_contact_email: (trustedEmail || '').toLowerCase().trim() || null,
      trusted_contact_name: (trustedName || '').toString().slice(0, 60) || null,
      sent_at: new Date().toISOString()
    });

    await sendResend(tpl.brand, email.toLowerCase().trim(), tpl.subject, renderBody(tpl.body, link));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, token, template: tpl.id }) };
  } catch (err) {
    console.error('training-send error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erreur serveur' }) };
  }
};
