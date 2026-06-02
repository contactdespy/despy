// ════════════════════════════════════════════
// DESPY — Analyseur SMS / email / lien
// Public : 3 analyses/jour/IP · Abonnés : illimité + historique
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = `Tu es un expert en cybersécurité spécialisé dans la détection d'arnaques en France.
Tu analyses des SMS, emails ou liens suspects et tu réponds UNIQUEMENT avec un JSON valide selon ce schéma :

{
  "verdict": "safe" | "suspicious" | "scam",
  "score": 0-100,
  "type": "sms" | "email" | "url" | "text",
  "title": "Titre court du verdict (max 60 car)",
  "signals": [
    { "level": "danger" | "warn" | "info", "text": "Signal détecté en français, max 100 car" }
  ],
  "recommendation": "Action concrète à prendre, max 200 car en français",
  "reportTo": "33700" | "signal-spam.fr" | "Pharos" | null
}

Règles :
- Score 0-30 = safe (vert), 31-70 = suspicious (orange), 71-100 = scam (rouge)
- Liste 3 à 6 signaux maximum, en commençant par les plus critiques
- Détecte : domaines usurpés, urgence artificielle, fautes d'orthographe, demandes de paiement, liens raccourcis, phishing, faux supports, fausses livraisons, faux impôts/CAF/Ameli/Sécu
- Pour reportTo : 33700 si SMS, signal-spam.fr si email, Pharos si menaces graves, null si rien à signaler
- Si on te fournit une capture d'écran : lis le texte visible (email, SMS, site web) et analyse-le. Si l'image ne contient aucun message lisible à analyser, renvoie verdict "suspicious" avec un signal "info" expliquant gentiment que la capture est illisible et qu'il faut réessayer avec une image plus nette.
- Ne réponds JAMAIS autre chose que ce JSON. Pas de markdown, pas de texte avant ou après.`;

async function analyseWithClaude(content, image) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Service IA indisponible');

  // Construire le contenu utilisateur : texte seul, ou image (+ contexte texte optionnel)
  let userContent;
  if (image) {
    const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(image);
    if (!m) throw new Error('Format image non supporté (PNG, JPEG, WEBP ou GIF attendu)');
    let mediaType = m[1].toLowerCase();
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
    const b64 = m[2];
    const instruction = (content && content.length >= 5)
      ? `Analyse cette capture d'écran d'un message potentiellement suspect. Contexte ajouté par la personne : "${content}"`
      : `Analyse cette capture d'écran (email, SMS ou site web). Lis le texte visible et détermine si c'est une arnaque.`;
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
      { type: 'text', text: instruction }
    ];
  } else {
    userContent = `Analyse ce message suspect :\n\n${content}`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    }),
    signal: AbortSignal.timeout(image ? 25000 : 15000)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('IA: ' + res.status + ' ' + txt.substring(0, 200));
  }
  const data = await res.json();
  const txt = data.content?.[0]?.text || '';
  // Parse JSON robuste (extrait le premier {...} valide)
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Réponse IA non-JSON');
  return JSON.parse(m[0]);
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { content, image, email } = JSON.parse(event.body || '{}');
    const hasImage = typeof image === 'string' && /^data:image\//i.test(image);
    const textContent = (content || '').trim();

    if (!hasImage && textContent.length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Collez un message (min 5 caractères) ou ajoutez une capture d\'écran.' }) };
    }
    if (textContent.length > 4000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Contenu trop long (max 4000 caractères)' }) };
    }
    // Limite taille image (~5 Mo en base64 ≈ 6,8M caractères)
    if (hasImage && image.length > 6800000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Image trop lourde (max 5 Mo).' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const ip = (event.headers['x-forwarded-for'] || '0.0.0.0').split(',')[0].trim();

    // Vérifier abonnement et quota
    let isSubscribed = false;
    let normEmail = null;
    if (email && email.includes('@')) {
      normEmail = email.toLowerCase().trim();
      const { data: client } = await supabase
        .from('clients')
        .select('subscribed')
        .eq('email', normEmail)
        .maybeSingle();
      isSubscribed = !!(client && client.subscribed);
    }

    // Quota IP pour non-abonnés : 3/jour
    if (!isSubscribed) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await supabase
        .from('analyses_history')
        .select('id', { count: 'exact', head: true })
        .eq('ip', ip)
        .gte('created_at', since);
      if ((count || 0) >= 3) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            limit_reached: true,
            error: 'Limite de 3 analyses gratuites par jour atteinte. Créez un compte pour continuer.'
          })
        };
      }
    }

    // Lancer l'analyse IA (texte et/ou capture d'écran)
    const result = await analyseWithClaude(textContent, hasImage ? image : null);

    // Normaliser
    const verdict = ['safe', 'suspicious', 'scam'].includes(result.verdict) ? result.verdict : 'suspicious';
    const score = Math.max(0, Math.min(100, parseInt(result.score) || 50));
    const signals = Array.isArray(result.signals) ? result.signals.slice(0, 6) : [];

    // Sauver en base
    await supabase.from('analyses_history').insert({
      email: normEmail,
      ip,
      content: (textContent || (hasImage ? '[Capture d\'écran analysée]' : '')).substring(0, 2000),
      verdict,
      score,
      signals,
      created_at: new Date().toISOString()
    });

    // Incrémenter compteur abonné
    if (normEmail && isSubscribed) {
      const { data: c } = await supabase.from('clients').select('analyses_count').eq('email', normEmail).maybeSingle();
      await supabase.from('clients').update({
        analyses_count: ((c && c.analyses_count) || 0) + 1
      }).eq('email', normEmail);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        verdict,
        score,
        type: result.type || 'text',
        title: result.title || 'Analyse',
        signals,
        recommendation: result.recommendation || '',
        reportTo: result.reportTo || null,
        is_subscribed: isSubscribed
      })
    };

  } catch (err) {
    console.error('analyse-message error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erreur serveur' }) };
  }
};
