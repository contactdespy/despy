// ════════════════════════════════════════════
// DESPY — Vérificateur de site marchand
// POST { url } → âge domaine (RDAP) + SSL + analyse IA
// ════════════════════════════════════════════

const { rateLimit } = require('./_auth');
function extractDomain(url) {
  try {
    var u = new URL(url);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch (e) { return null; }
}

async function getDomainAge(domain) {
  // RDAP — protocole standardisé pour récupérer les infos d'enregistrement
  try {
    const res = await fetch('https://rdap.org/domain/' + domain, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const events = data.events || [];
    const reg = events.find(e => /registration/i.test(e.eventAction));
    if (!reg || !reg.eventDate) return null;
    const created = new Date(reg.eventDate);
    const ageMs = Date.now() - created.getTime();
    return {
      created_at: reg.eventDate,
      age_days: Math.floor(ageMs / (24 * 3600 * 1000))
    };
  } catch (e) {
    return null;
  }
}

async function probeSite(url) {
  const probe = { reachable: false, https: false, status: 0, title: '', description: '', body_excerpt: '' };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
      headers: { 'User-Agent': 'DespyBot/1.0 (despy.fr)' }
    });
    probe.reachable = true;
    probe.https = res.url.startsWith('https://');
    probe.status = res.status;
    if (res.status < 400) {
      try {
        const html = (await res.text()).slice(0, 50000);
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) probe.title = titleMatch[1].trim().slice(0, 200);
        const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
        if (descMatch) probe.description = descMatch[1].trim().slice(0, 300);
        const txt = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        probe.body_excerpt = txt.slice(0, 1500);
      } catch (e) { /* parsing best-effort */ }
    }
  } catch (e) {
    probe.reachable = false;
    probe.error = e.message;
  }
  return probe;
}

const ANALYSIS_PROMPT = `Tu es un expert en détection de sites marchands frauduleux.
Tu reçois des informations sur un site web et tu réponds UNIQUEMENT avec ce JSON :

{
  "verdict": "safe" | "caution" | "dangerous",
  "score": 0-100,
  "signals": [
    { "level": "danger" | "warn" | "info", "text": "Signal détecté en français, max 110 car" }
  ],
  "recommendation": "Conseil concret en français, max 200 car"
}

Règles :
- Score 0-30 = safe, 31-65 = caution, 66-100 = dangerous
- Liste 3 à 5 signaux. Détecte : domaine récent (<3 mois = drapeau rouge), TLD suspect (.xyz .top .click .fit), nom usurpant une marque connue, fautes d'orthographe, prix anormalement bas, mentions légales absentes, contact inexistant, paiements non sécurisés, copie d'un site connu
- Sois bienveillant : un domaine vieux + SSL OK + contenu cohérent = safe même sans certitude absolue
- Pas de markdown. Uniquement le JSON.`;

async function analyseWithClaude(domainInfo, probe, ageInfo) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Service IA indisponible');

  const ageDescription = ageInfo
    ? `Âge du domaine : ${ageInfo.age_days} jours (créé le ${ageInfo.created_at.slice(0, 10)})`
    : 'Âge du domaine : inconnu (RDAP indisponible)';

  const userMsg = [
    'Domaine : ' + domainInfo,
    ageDescription,
    'HTTPS : ' + (probe.https ? 'oui' : 'NON'),
    'Statut HTTP : ' + (probe.status || 'injoignable'),
    probe.title ? 'Titre : ' + probe.title : '',
    probe.description ? 'Description : ' + probe.description : '',
    probe.body_excerpt ? '\nExtrait du contenu :\n' + probe.body_excerpt : ''
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: userMsg }]
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('IA: ' + res.status);
  const data = await res.json();
  const txt = data.content?.[0]?.text || '';
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

  // Anti-abus : outil public → limite par IP (15 appels / 10 min).
  // Largement assez pour un humain, bloque le martelage par robot
  // (quota HIBP / consommation Netlify / appels IA).
  if (!rateLimit(event, 'site-check', 15, 10 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de vérifications. Réessayez dans quelques minutes.' }) };
  }

  try {
    const { url } = JSON.parse(event.body || '{}');
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL requise' }) };

    let cleanUrl = String(url).trim();
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
    const domain = extractDomain(cleanUrl);
    if (!domain) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL invalide' }) };

    // Anti-abus : refuser quelques domaines évidents
    const blockedDomains = ['localhost', '127.0.0.1', '0.0.0.0', 'despy.fr'];
    if (blockedDomains.includes(domain)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Domaine non analysable' }) };
    }

    // Lancer en parallèle : RDAP + probe HTTP
    const [ageInfo, probe] = await Promise.all([
      getDomainAge(domain),
      probeSite(cleanUrl)
    ]);

    // Construire les checks visuels
    const checks = [
      { label: 'Site joignable', ok: probe.reachable && probe.status > 0 && probe.status < 400 },
      { label: 'Connexion sécurisée HTTPS', ok: probe.https }
    ];
    if (ageInfo) {
      checks.push({
        label: ageInfo.age_days >= 365 ? 'Domaine établi (>1 an)' : ageInfo.age_days >= 90 ? 'Domaine de quelques mois' : 'Domaine récent (<3 mois) — risque',
        ok: ageInfo.age_days >= 90
      });
    }

    // Si site totalement injoignable, pas besoin d'IA
    if (!probe.reachable) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          domain,
          verdict: 'dangerous',
          score: 80,
          domain_age_days: ageInfo ? ageInfo.age_days : null,
          checks,
          signals: [
            { level: 'danger', text: 'Le site est injoignable. Vérifiez l\'URL ou évitez ce site.' }
          ],
          recommendation: 'N\'achetez pas. Un site marchand légitime doit être accessible 24/7.'
        })
      };
    }

    // Analyse IA
    let aiResult;
    try {
      aiResult = await analyseWithClaude(domain, probe, ageInfo);
    } catch (e) {
      console.error('IA error:', e);
      aiResult = {
        verdict: 'caution',
        score: 50,
        signals: [{ level: 'warn', text: 'Analyse IA indisponible — vérification manuelle recommandée.' }],
        recommendation: 'Vérifiez les avis sur Trustpilot et les mentions légales avant d\'acheter.'
      };
    }

    // Bonus/malus selon âge domaine
    let finalScore = aiResult.score || 50;
    const finalSignals = aiResult.signals || [];
    if (ageInfo) {
      if (ageInfo.age_days < 30) {
        finalScore = Math.max(finalScore, 75);
        finalSignals.unshift({ level: 'danger', text: 'Domaine créé il y a moins de 30 jours — drapeau rouge majeur' });
      } else if (ageInfo.age_days < 90) {
        finalScore = Math.max(finalScore, 55);
        finalSignals.unshift({ level: 'warn', text: 'Domaine créé il y a moins de 3 mois — méfiance' });
      }
    }
    if (!probe.https) {
      finalScore = Math.max(finalScore, 70);
      finalSignals.unshift({ level: 'danger', text: 'Pas de connexion HTTPS — ne saisissez aucune donnée bancaire' });
    }

    let finalVerdict = 'caution';
    if (finalScore <= 30) finalVerdict = 'safe';
    else if (finalScore >= 66) finalVerdict = 'dangerous';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        domain,
        verdict: finalVerdict,
        score: finalScore,
        domain_age_days: ageInfo ? ageInfo.age_days : null,
        checks,
        signals: finalSignals.slice(0, 6),
        recommendation: aiResult.recommendation || 'Vérifiez toujours les mentions légales et les avis avant un achat.'
      })
    };

  } catch (err) {
    console.error('site-check error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erreur serveur' }) };
  }
};
