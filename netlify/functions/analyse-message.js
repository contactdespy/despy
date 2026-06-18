// ════════════════════════════════════════════
// DESPY — Analyseur SMS / email / lien
// Anonyme : 1 analyse/jour/IP · Compte gratuit : 3/jour · Abonnés : illimité + historique
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = `Tu es un expert en cybersécurité spécialisé dans la détection d'arnaques en France. Ton rôle : protéger SANS crier au loup. Une fausse alerte sur un vrai message inquiète pour rien et fait perdre confiance, alors juge avec discernement.

Tu analyses des SMS, emails ou liens et tu réponds UNIQUEMENT avec un JSON valide selon ce schéma :

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

Comment juger (équilibré) :
- Cherche les VRAIS signaux d'arnaque : demande de mot de passe / code / carte bancaire / RIB, domaine d'expéditeur usurpé ou douteux, lien qui ne pointe pas vers le site officiel, urgence ou menace, fautes grossières, numéro surtaxé, pièce jointe inattendue.
- Reconnais aussi les signaux de LÉGITIMITÉ : expéditeur sur le vrai domaine de la marque, détails cohérents (n° de commande, montant), AUCUNE demande d'identifiants, pas de pression, liens vers le domaine officiel. Un vrai email transactionnel (confirmation de commande, reçu) NE doit PAS être classé "scam" juste parce qu'il parle d'argent.

Calibration du verdict :
- "scam" (71-100) UNIQUEMENT s'il y a un ou plusieurs vrais signaux d'arnaque clairs ci-dessus.
- "suspicious" (31-70) si le message RESSEMBLE à un format à risque mais POURRAIT être authentique. Cas typique : « votre commande/paiement est confirmé, cliquez ici pour annuler » — c'est l'un des formats d'arnaque les plus courants (fausse commande/faux prélèvement), MAIS de vrais emails de ce type existent. Dans ce cas : "suspicious", explique honnêtement le doute, et indique comment vérifier sans risque.
- "safe" (0-30) si c'est clairement un message normal et légitime, sans aucun signal d'arnaque.
- En cas d'hésitation, reste prudent MAIS n'affirme pas "arnaque" sans preuve : préfère "suspicious" à "scam".

Règle d'or — à mettre dans "recommendation" dès qu'il y a un lien ou un numéro : ne jamais cliquer le lien ni appeler le numéro DU message ; ouvrir soi-même l'application officielle ou taper l'adresse à la main, ou rappeler le numéro officiel connu. Ce réflexe protège que le message soit vrai OU faux.

Autres règles :
- Score 0-30 = safe (vert), 31-70 = suspicious (orange), 71-100 = scam (rouge)
- 3 à 6 signaux maximum, les plus critiques d'abord. Pour un cas "suspicious", inclure au moins un signal "info" qui nuance (ex : « Ce format existe en version légitime, mais aussi en arnaque très courante »).
- reportTo : 33700 si SMS d'arnaque, signal-spam.fr si email d'arnaque, Pharos si menaces graves, null si rien à signaler ou si le message semble légitime.
- Capture d'écran : lis le texte visible (email, SMS, site web) et analyse-le. Si l'image ne contient aucun message lisible, renvoie verdict "suspicious" avec un signal "info" expliquant gentiment qu'elle est illisible et qu'il faut réessayer avec une image plus nette.
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
    let clientRow = null;
    if (email && email.includes('@')) {
      normEmail = email.toLowerCase().trim();
      const { data: client } = await supabase
        .from('clients')
        .select('subscribed, prenom, name, trusted_contact_name, trusted_contact_email')
        .eq('email', normEmail)
        .maybeSingle();
      clientRow = client;
      isSubscribed = !!(client && client.subscribed);
    }

    // Quotas pour non-abonnés (capture du lead au bon moment) :
    //  - Visiteur anonyme (sans compte) : 1 analyse/jour/IP → on l'incite à créer un compte gratuit
    //  - Compte gratuit (connecté)      : 3 analyses/jour    → on l'incite à passer à l'abonnement
    if (!isSubscribed) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      if (normEmail) {
        // Compte gratuit : quota par email, 3/jour
        const { count } = await supabase
          .from('analyses_history')
          .select('id', { count: 'exact', head: true })
          .eq('email', normEmail)
          .gte('created_at', since);
        if ((count || 0) >= 3) {
          return {
            statusCode: 429,
            headers,
            body: JSON.stringify({
              limit_reached: true,
              tier: 'free',
              error: 'Vous avez utilisé vos 3 analyses gratuites du jour. Passez à l\'illimité avec l\'abonnement Despy.'
            })
          };
        }
      } else {
        // Visiteur anonyme : quota par IP, 1/jour
        const { count } = await supabase
          .from('analyses_history')
          .select('id', { count: 'exact', head: true })
          .eq('ip', ip)
          .is('email', null)
          .gte('created_at', since);
        if ((count || 0) >= 1) {
          return {
            statusCode: 429,
            headers,
            body: JSON.stringify({
              limit_reached: true,
              tier: 'anon',
              error: 'Vous avez utilisé votre analyse gratuite. Créez votre compte gratuit pour continuer.'
            })
          };
        }
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

    // Cercle de confiance : si une arnaque est détectée pour un compte
    // ayant désigné un proche, ce dernier est alerté (sans le contenu
    // du message — uniquement le type de menace et les bons réflexes).
    if (verdict === 'scam' && clientRow && clientRow.trusted_contact_email) {
      try {
        const prenom = clientRow.prenom || (clientRow.name || '').split(' ')[0] || 'votre proche';
        const cName = clientRow.trusted_contact_name || '';
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({
            type: 'custom',
            data: {
              email: clientRow.trusted_contact_email,
              subject: `🚨 Despy — Une arnaque visant ${prenom} vient d'être bloquée`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
                  <div style="background:#dc2626;padding:24px 28px;color:#fff">
                    <div style="font-size:11px;font-weight:700;opacity:.85;letter-spacing:2px">DESPY — CERCLE DE CONFIANCE</div>
                    <div style="font-size:21px;font-weight:900;margin-top:6px">🚨 Arnaque détectée pour ${prenom}</div>
                  </div>
                  <div style="padding:28px">
                    <p style="font-size:15px;color:#333;line-height:1.7">Bonjour${cName ? ' ' + cName : ''},</p>
                    <p style="font-size:14px;color:#555;line-height:1.7"><strong>${prenom}</strong> vient de faire vérifier un message suspect sur Despy. Verdict : <strong style="color:#dc2626">${result.title || 'arnaque détectée'}</strong> (niveau de danger ${score}/100). La bonne nouvelle : ${prenom} a eu le bon réflexe de vérifier <em>avant</em> de cliquer.</p>
                    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:16px;margin:18px 0">
                      <p style="font-weight:700;color:#dc2626;margin:0 0 10px;font-size:14px">💛 Ce que vous pouvez faire</p>
                      <div style="font-size:13px;color:#555;line-height:1.9">
                        1. <strong>Appelez ${prenom}</strong> pour en parler — les arnaqueurs réessaient souvent<br>
                        2. Vérifiez ensemble qu'il/elle n'a <strong>ni cliqué, ni payé, ni répondu</strong><br>
                        3. Rappelez-lui : en cas de doute, on vérifie sur Despy <em>avant</em> d'agir
                      </div>
                    </div>
                    <p style="font-size:12px;color:#888;line-height:1.6">Par respect de sa vie privée, le contenu exact du message n'est pas transmis. Vous recevez cette alerte car ${prenom} vous a désigné comme personne de confiance sur Despy.</p>
                    <p style="font-size:11px;color:#aaa;text-align:center;margin-top:20px">Despy · Analyse anti-arnaque · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
                  </div>
                </div>`
            }
          })
        });
      } catch (e) { console.warn('Alerte proche analyse échouée:', e.message); }
    }

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
