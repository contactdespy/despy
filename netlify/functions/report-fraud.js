// ════════════════════════════════════════════
// DESPY — Alerte Secteur : signalement d'une fraude locale
// POST auth (tout compte Despy, même gratuit)
// { category, description, code_postal, ville, user_email }
//
// Pipeline anti-diffamation (le point juridique clé) :
//   1. Géocodage commune via l'API officielle geo.api.gouv.fr (gratuite)
//   2. Modération par Claude : catégorie validée, description RÉÉCRITE
//      sans nom de personne/société, sans adresse précise, sans téléphone
//   3. Confiance haute → publié automatiquement ; sinon → file de
//      validation (boutons ✅/🚫 par email, comme Privacy Cleanup)
//   4. À l'approbation → alertes temps réel aux abonnés premium du
//      département (via fraud-moderate.js / dispatchFraudAlert)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth, rateLimit } = require('./_auth');
const { signFinding } = require('./_privacy-sign');
const { dispatchFraudAlert, CATEGORIES } = require('./_fraud-alerts');

// Géocodage commune (API officielle de l'État, sans clé)
async function geocode(codePostal, ville) {
  const res = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(codePostal)}&fields=nom,centre&format=json`, {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const communes = await res.json();
  if (!communes || communes.length === 0) return null;
  // Si plusieurs communes pour ce CP, on privilégie celle dont le nom colle
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const match = communes.find(c => norm(c.nom) === norm(ville)) || communes[0];
  const [lng, lat] = (match.centre && match.centre.coordinates) || [null, null];
  return { nom: match.nom, lat, lng };
}

// Modération : réécrit la description sans données identifiantes.
async function moderate(category, description, ville) {
  const prompt = `Tu es le modérateur de la carte communautaire des arnaques locales de Despy (public : seniors, France).

SIGNALEMENT reçu (commune : ${ville}) :
- Catégorie déclarée : ${category}
- Description : "${(description || '').slice(0, 600)}"

Ta mission, réponds UNIQUEMENT en JSON :
{"ok": true|false, "category": "faux_artisan|faux_agent|demarchage_abusif|arnaque_telephone|faux_livreur|vol_ruse|autre", "clean_description": "...", "confidence": 0.0-1.0, "reason": "une phrase"}

Règles STRICTES :
- "clean_description" : réécris la description en 1-2 phrases utiles aux voisins, SANS AUCUN nom de personne, nom d'entreprise, adresse précise, numéro de téléphone, plaque, ou détail identifiant. Garde le mode opératoire (ex : "Un homme se présentant comme agent des eaux demande à entrer pour vérifier les canalisations").
- ok=false si : ce n'est pas un signalement d'arnaque locale (spam, insulte, réclamation commerciale, conflit de voisinage, propos haineux), ou si c'est invérifiable et purement diffamatoire.
- Corrige la catégorie si elle ne colle pas.
- confidence < 0.8 si le contenu est limite ou ambigu (il sera alors validé par un humain).`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`moderation HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '{}';
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : '{}');
}

// Email de validation à l'équipe pour les cas ambigus
async function notifyModeration(report, cleanDesc, reason) {
  const base = process.env.URL || 'https://despy.fr';
  const approveUrl = `${base}/.netlify/functions/fraud-moderate?f=${report.id}&a=approve&k=${signFinding('fraud', report.id, 'approve')}`;
  const rejectUrl = `${base}/.netlify/functions/fraud-moderate?f=${report.id}&a=reject&k=${signFinding('fraud', report.id, 'reject')}`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Despy — Alerte Secteur <contact@despy.fr>',
        to: ['contact.despy@gmail.com'],
        subject: `🗺️ Signalement à valider — ${report.ville} (${CATEGORIES[report.category] || report.category})`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.7;max-width:600px">
          <h2 style="color:#0a1f3a">🗺️ Signalement en attente de validation</h2>
          <p><strong>${report.ville} (${report.code_postal})</strong> · ${CATEGORIES[report.category] || report.category}</p>
          <div style="background:#f8fafc;border-left:4px solid #2D5BFF;padding:12px 16px;border-radius:0 10px 10px 0">${cleanDesc}</div>
          <p style="color:#888;font-size:12px">Motif de la mise en attente : ${reason || 'confiance modération insuffisante'}</p>
          <p>
            <a href="${approveUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700;margin-right:8px">✅ Publier</a>
            <a href="${rejectUrl}" style="display:inline-block;background:#eef1f5;color:#555;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">🚫 Rejeter</a>
          </p>
        </div>`
      })
    });
  } catch (e) { console.error('notif modération:', e.message); }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  if (!rateLimit(event, 'fraudreport', 5, 60 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de signalements. Réessayez dans une heure.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const auth = requireAuth(event, body, body.user_email, headers);
  if (!auth.ok) return auth.response;

  const category = String(body.category || '').trim();
  const description = String(body.description || '').trim();
  const codePostal = String(body.code_postal || '').replace(/\D/g, '');
  const ville = String(body.ville || '').trim().slice(0, 80);

  if (!CATEGORIES[category]) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Catégorie invalide.' }) };
  if (codePostal.length !== 5) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code postal invalide.' }) };
  if (description.length < 15) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Décrivez brièvement ce qui s\'est passé (au moins 15 caractères).' }) };

  try {
    // 1. Géocodage
    const geo = await geocode(codePostal, ville);
    if (!geo) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Commune introuvable pour ce code postal.' }) };

    // 2. Modération IA (anti-diffamation)
    let mod;
    try { mod = await moderate(category, description, geo.nom); }
    catch (e) {
      console.error('moderation error:', e.message);
      mod = { ok: true, category, clean_description: null, confidence: 0, reason: 'modération indisponible' };
    }
    if (mod.ok === false) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ce signalement ne peut pas être publié : ' + (mod.reason || 'contenu non conforme') + '. En cas d\'urgence, utilisez le bouton SOS.' }) };
    }

    const finalCategory = CATEGORIES[mod.category] ? mod.category : category;
    const cleanDesc = (mod.clean_description || '').slice(0, 400) || null;
    const confidence = Number(mod.confidence) || 0;
    const autoApprove = confidence >= 0.8 && cleanDesc;

    // 3. Enregistrement
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: inserted, error } = await supabase.from('fraud_reports').insert({
      reporter_email: auth.email,
      category: finalCategory,
      description: cleanDesc,
      ville: geo.nom,
      code_postal: codePostal,
      lat: geo.lat, lng: geo.lng,
      status: autoApprove ? 'approved' : 'pending',
      confidence
    }).select('id, category, description, ville, code_postal').single();
    if (error) throw new Error(error.message);

    // 4. Publication auto → alerte immédiate premium ; sinon file de validation
    if (autoApprove) {
      try { await dispatchFraudAlert(supabase, inserted); }
      catch (e) { console.error('dispatch alert:', e.message); }
    } else {
      await notifyModeration({ ...inserted, code_postal: codePostal }, cleanDesc || description.slice(0, 200), mod.reason);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        published: autoApprove,
        message: autoApprove
          ? 'Merci ! Votre signalement est publié : les habitants de votre secteur sont prévenus.'
          : 'Merci ! Votre signalement est en cours de vérification par notre équipe (publication sous quelques heures).'
      })
    };
  } catch (err) {
    console.error('report-fraud:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur, réessayez.' }) };
  }
};
