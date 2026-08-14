// ════════════════════════════════════════════
// DESPY — Aimant à leads : guide "5 arnaques qui visent vos parents"
// Capte l'email depuis /guide → enregistre le lead → envoie le PDF
// → déclenche l'événement Meta "Lead" (CAPI) pour l'optimisation des pubs
// Public (pas d'auth), protégé par rate limiting.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { rateLimit } = require('./_auth');

const GUIDE_URL = 'https://despy.fr/despy-guide-5-arnaques-parents.pdf';

// ── Meta Conversions API : événement "Lead" (même logique que register-free) ──
async function sendMetaCAPI(opts) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) return;
  const sha = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
  const userData = {};
  if (opts.email) userData.em = [sha(opts.email)];
  if (opts.ip) userData.client_ip_address = opts.ip;
  if (opts.ua) userData.client_user_agent = opts.ua;
  if (opts.fbp) userData.fbp = opts.fbp;
  if (opts.fbc) userData.fbc = opts.fbc;
  const evt = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: opts.eventId,
    action_source: 'website',
    event_source_url: 'https://despy.fr/guide',
    user_data: userData
  };
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evt] }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) console.warn('Meta CAPI:', (await res.text()).substring(0, 200));
  } catch (e) { console.warn('Meta CAPI error:', e.message); }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Anti-abus : 8 demandes / heure / IP
    if (!rateLimit(event, 'guide', 8, 60 * 60 * 1000)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de demandes. Réessayez plus tard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { email, prenom, fbp, fbc, source, marketing_consent } = body;

    if (!email || !email.includes('@') || email.length > 200) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Adresse email invalide.' }) };
    }
    const norm = email.toLowerCase().trim();
    const cleanPrenom = (prenom || '').toString().trim().slice(0, 60) || null;

    // La provenance vient du navigateur : on ne lui fait pas confiance, on la
    // borne. Étiquette de canal uniquement — jamais d'identifiant de clic.
    const sourceNettoyee = String(source || '')
      .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'guide_5_arnaques';

    // 1) Enregistrer le lead (best-effort : ne bloque jamais l'envoi du guide)
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await supabase
        .from('guide_leads')
        .upsert({
          email: norm,
          prenom: cleanPrenom,
          source: sourceNettoyee,
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });
    } catch (e) {
      console.error('guide_leads upsert error (non bloquant):', e.message);
    }

    // 2) Envoyer le guide par email (via send-email, template guide_delivery)
    try {
      const baseUrl = process.env.URL || 'https://despy.fr';
      const res = await fetch(`${baseUrl}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_SECRET || ''
        },
        body: JSON.stringify({
          type: 'guide_delivery',
          data: { email: norm, prenom: cleanPrenom, guideUrl: GUIDE_URL }
        })
      });
      if (!res.ok) {
        console.error('send-email guide_delivery failed:', res.status, (await res.text()).substring(0, 200));
        return { statusCode: 502, headers, body: JSON.stringify({ error: "L'envoi de l'email a échoué. Réessayez." }) };
      }
    } catch (e) {
      console.error('send-email error:', e.message);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "L'envoi de l'email a échoué. Réessayez." }) };
    }

    // 3) Conversion Meta "Lead" côté serveur (si consentement marketing donné)
    let capiEventId = null;
    if (marketing_consent) {
      capiEventId = 'lead_' + crypto.randomBytes(8).toString('hex');
      await sendMetaCAPI({
        email: norm,
        eventId: capiEventId,
        ip: (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined,
        ua: event.headers['user-agent'] || undefined,
        fbp: fbp || undefined,
        fbc: fbc || undefined
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, capiEventId }) };

  } catch (err) {
    console.error('guide-lead error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
