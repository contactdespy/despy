// ════════════════════════════════════════════
// DESPY — Agent IA Facebook
// Cron : chaque jour à 8h30 (cf. netlify.toml)
// 1. Récupère ou génère le Page Access Token (cache Supabase)
// 2. Choisit le type de post selon le jour de la semaine
// 3. Lit les données Despy (analyses, alertes) pour contextualiser
// 4. Génère le post via Claude AI (ton expert rassurant, FR, seniors)
// 5. Poste sur la Page Facebook Despy
// 6. Log dans social_posts (audit)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const FB_API_VERSION = 'v18.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_API_VERSION}`;

// ── Helpers ──────────────────────────────────

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  try { return { ok: res.ok, data: JSON.parse(text), status: res.status }; }
  catch { return { ok: res.ok, data: { raw: text }, status: res.status }; }
}

// Récupère le Page Access Token, depuis le cache Supabase si possible
async function getPageAccessToken(supabase) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageId) throw new Error('FACEBOOK_PAGE_ID manquant');

  // 1. Tenter le cache
  const { data: cached } = await supabase
    .from('facebook_tokens')
    .select('page_access_token, validated_at')
    .eq('page_id', pageId)
    .maybeSingle();

  if (cached && cached.page_access_token) {
    // Vérifie la validité du token caché tous les 7 jours
    const validatedAt = cached.validated_at ? new Date(cached.validated_at) : null;
    const stale = !validatedAt || (Date.now() - validatedAt.getTime() > 7 * 24 * 3600 * 1000);

    if (!stale) {
      return cached.page_access_token;
    }

    // Vérification rapide : ping de l'API
    const check = await fetchJson(`${FB_GRAPH}/me?access_token=${cached.page_access_token}`);
    if (check.ok && check.data.id === pageId) {
      await supabase.from('facebook_tokens')
        .update({ validated_at: new Date().toISOString() })
        .eq('page_id', pageId);
      return cached.page_access_token;
    }
    // Token invalide → on régénère ci-dessous
    console.warn('Page token périmé, régénération...');
  }

  // 2. Pas de cache valide → exchange complet
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const userToken = process.env.FACEBOOK_USER_TOKEN;
  if (!appId || !appSecret || !userToken) {
    throw new Error('FACEBOOK_APP_ID, FACEBOOK_APP_SECRET ou FACEBOOK_USER_TOKEN manquant');
  }

  // 2a. Exchange short-lived → long-lived user token (60 jours)
  const exchangeUrl = `${FB_GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
    + `&client_id=${appId}&client_secret=${encodeURIComponent(appSecret)}`
    + `&fb_exchange_token=${userToken}`;
  const exchange = await fetchJson(exchangeUrl);
  if (!exchange.ok || !exchange.data.access_token) {
    throw new Error('Échec exchange user token : ' + JSON.stringify(exchange.data));
  }
  const longLivedUserToken = exchange.data.access_token;

  // 2b. Récupère la liste des pages avec leur token
  const pagesRes = await fetchJson(`${FB_GRAPH}/me/accounts?access_token=${longLivedUserToken}`);
  if (!pagesRes.ok || !pagesRes.data.data) {
    throw new Error('Échec récupération pages : ' + JSON.stringify(pagesRes.data));
  }
  const despyPage = pagesRes.data.data.find(p => p.id === pageId);
  if (!despyPage) {
    throw new Error(`Page Despy (${pageId}) introuvable dans les pages autorisées`);
  }

  const pageAccessToken = despyPage.access_token;

  // 2c. Cache dans Supabase (le Page Token issu d'un long-lived user token est permanent)
  await supabase.from('facebook_tokens').upsert({
    page_id: pageId,
    page_access_token: pageAccessToken,
    long_lived_user_token: longLivedUserToken,
    validated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'page_id' });

  return pageAccessToken;
}

// ── Choix du type de post selon le jour ──────

function getPostTypeForToday() {
  const days = ['rappel-securite', 'bilan-semaine', 'alerte-arnaque', 'conseil-pratique', 'alerte-arnaque', 'quiz', 'temoignage'];
  // 0 = dimanche, 1 = lundi, ...
  return days[new Date().getDay()];
}

// ── Lecture contextuelle Supabase ────────────

async function getContextData(supabase) {
  const ctx = { recentScams: [], topDomains: [], nationalAlerts: [], statsWeek: {} };

  // Arnaques détectées la semaine passée
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: scams } = await supabase
    .from('analyses_history')
    .select('content, verdict, created_at, signals')
    .eq('verdict', 'scam')
    .gte('created_at', weekAgo)
    .limit(50);
  ctx.recentScams = scams || [];

  // Top domaines suspects (24 dernières heures)
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recentDay } = await supabase
    .from('analyses_history')
    .select('content')
    .eq('verdict', 'scam')
    .gte('created_at', dayAgo)
    .limit(100);
  const domainCount = {};
  (recentDay || []).forEach(r => {
    const matches = (r.content || '').match(/[a-z0-9-]+\.[a-z]{2,}/gi) || [];
    matches.forEach(m => {
      const dom = m.toLowerCase();
      if (/(laposte|chronopost|amazon|leboncoin|fnac|sncf|cdiscount|bnpparibas|creditmutuel|lcl|hsbc|despy|ameli)\.[a-z]{2,}/i.test(dom)) return;
      domainCount[dom] = (domainCount[dom] || 0) + 1;
    });
  });
  ctx.topDomains = Object.entries(domainCount)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([dom, count]) => ({ dom, count }));

  // Alertes nationales récentes (ANSSI + Despy)
  const { data: alerts } = await supabase
    .from('national_alerts')
    .select('title, body, source, url, created_at')
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false })
    .limit(5);
  ctx.nationalAlerts = alerts || [];

  // Stats de la semaine
  const { count: scamCount } = await supabase
    .from('analyses_history')
    .select('id', { count: 'exact', head: true })
    .eq('verdict', 'scam')
    .gte('created_at', weekAgo);

  const { count: totalCount } = await supabase
    .from('analyses_history')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', weekAgo);

  const { count: phoneReports } = await supabase
    .from('phone_reports')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', weekAgo);

  ctx.statsWeek = { scams: scamCount || 0, total: totalCount || 0, phones: phoneReports || 0 };

  return ctx;
}

// ── Prompts par type de post ─────────────────

function buildPrompt(postType, ctx) {
  const dateFr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const baseRules = `RÈGLES STRICTES (à respecter sans exception) :
- Écris en français impeccable, sans anglicismes inutiles
- Public cible : seniors (60+ ans), peu à l'aise avec la technologie
- Ton : expert rassurant ET PERSUASIF. Joue sur la peur saine (conséquences réelles) puis rassure avec la solution (Despy)
- Phrases courtes (max 15 mots)
- Pas de jargon technique non expliqué (toujours définir entre parenthèses si besoin)
- Maximum 4 emojis bien placés dans tout le post (pas plus)
- Longueur totale : 700 à 1300 caractères (environ 100 à 200 mots)
- N'invente JAMAIS de chiffres, dates, ou faits non fournis dans les données
- Tutoiement INTERDIT — vouvoiement uniquement
- Pas de mention "Despy" plus de 2 fois dans le post

🎯 MISE EN FORME — GRAS UNICODE OBLIGATOIRE :
Facebook ne supporte pas le markdown. Pour mettre en valeur les mots/phrases importants, utilise les caractères Unicode mathématiques bold sans sérif :
- A→𝗔 B→𝗕 C→𝗖 D→𝗗 E→𝗘 F→𝗙 G→𝗚 H→𝗛 I→𝗜 J→𝗝 K→𝗞 L→𝗟 M→𝗠 N→𝗡 O→𝗢 P→𝗣 Q→𝗤 R→𝗥 S→𝗦 T→𝗧 U→𝗨 V→𝗩 W→𝗪 X→𝗫 Y→𝗬 Z→𝗭
- a→𝗮 b→𝗯 c→𝗰 d→𝗱 e→𝗲 f→𝗳 g→𝗴 h→𝗵 i→𝗶 j→𝗷 k→𝗸 l→𝗹 m→𝗺 n→𝗻 o→𝗼 p→𝗽 q→𝗾 r→𝗿 s→𝘀 t→𝘁 u→𝘂 v→𝘃 w→𝘄 x→𝘅 y→𝘆 z→𝘇
- 0→𝟬 1→𝟭 2→𝟮 3→𝟯 4→𝟰 5→𝟱 6→𝟲 7→𝟳 8→𝟴 9→𝟵
- Caractères accentués : à→à é→é è→è ê→ê ô→ô ç→ç (LAISSE-LES TELS QUELS, pas de gras pour eux)
- Mets EN GRAS UNICODE :
  • L'accroche d'ouverture (1ère phrase ou question d'accroche)
  • Les chiffres marquants (€, %, nombre de victimes…)
  • Les mots-clés d'urgence (𝗔𝘁𝘁𝗲𝗻𝘁𝗶𝗼𝗻, 𝗔𝗿𝗻𝗮𝗾𝘂𝗲, 𝗨𝗿𝗴𝗲𝗻𝘁…)
  • Le lien d'appel à l'action 𝗱𝗲𝘀𝗽𝘆.𝗳𝗿
- Maximum 3-4 zones en gras par post (sinon ça perd son impact)

⚠️ LEVIER ÉMOTIONNEL ET CONVERSION :
Le but est de convertir les lecteurs en visiteurs de despy.fr. Pour chaque post :
1. Commence par une 𝗽𝗲𝘂𝗿 𝗰𝗼𝗻𝗰𝗿𝗲̀𝘁𝗲 (perte d'argent, compte piraté, identité volée, isolement après arnaque)
2. Donne UN exemple parlant (un retraité a perdu 3500€, un compte vidé en 10 minutes…)
3. Apporte LA solution simple = utiliser Despy
4. CTA puissant et urgent vers despy.fr

STRUCTURE OBLIGATOIRE :
1. 𝗔𝗰𝗰𝗿𝗼𝗰𝗵𝗲 𝗳𝗼𝗿𝘁𝗲 en gras Unicode (question + chiffre choc OU avertissement direct)
2. Mise en contexte qui suscite l'inquiétude (3-4 phrases — conséquences réelles)
3. Rassurance + solution Despy (2-3 phrases — "vous n'êtes pas seul·e", "Despy vous protège")
4. 𝗖𝗧𝗔 𝗳𝗶𝗻𝗮𝗹 𝗲𝗻 𝗴𝗿𝗮𝘀 vers despy.fr (urgent, bénéfice clair, gratuit)

Exemples de CTA finaux à varier :
- 👉 𝗩𝗲́𝗿𝗶𝗳𝗶𝗲𝘇 𝘃𝗼𝘁𝗿𝗲 𝘀𝗲́𝗰𝘂𝗿𝗶𝘁𝗲́ 𝗴𝗿𝗮𝘁𝘂𝗶𝘁𝗲𝗺𝗲𝗻𝘁 𝘀𝘂𝗿 𝗱𝗲𝘀𝗽𝘆.𝗳𝗿
- 👉 𝗡𝗲 𝘀𝗼𝘆𝗲𝘇 𝗽𝗮𝘀 𝗹𝗮 𝗽𝗿𝗼𝗰𝗵𝗮𝗶𝗻𝗲 𝘃𝗶𝗰𝘁𝗶𝗺𝗲. 𝗥𝗲𝗻𝗱𝗲𝘇-𝘃𝗼𝘂𝘀 𝘀𝘂𝗿 𝗱𝗲𝘀𝗽𝘆.𝗳𝗿
- 👉 𝗣𝗿𝗼𝘁𝗲́𝗴𝗲𝘇-𝘃𝗼𝘂𝘀 𝗲𝗻 𝟯 𝗺𝗶𝗻𝘂𝘁𝗲𝘀 𝘀𝘂𝗿 𝗱𝗲𝘀𝗽𝘆.𝗳𝗿
- 👉 𝗧𝗲𝘀𝘁𝗲𝘇 𝗱𝗲𝘀𝗽𝘆.𝗳𝗿 𝗮𝘃𝗮𝗻𝘁 𝗾𝘂𝗲 𝗰̧𝗮 𝗻𝗲 𝘃𝗼𝘂𝘀 𝗮𝗿𝗿𝗶𝘃𝗲

Renvoie UNIQUEMENT le texte du post Facebook avec les caractères Unicode bold correctement appliqués, prêt à publier. Pas de balises markdown, pas d'introduction de ta part.`;

  let topic = '';
  let dataBlock = '';

  switch (postType) {
    case 'alerte-arnaque':
      topic = `Alerte arnaque du jour.
Mission : alerter sur une arnaque concrète qui circule actuellement.
Choisis parmi les données fournies ci-dessous la menace la plus pertinente (un domaine récurrent OU une alerte officielle ANSSI/Cybermalveillance).
Explique en 3 phrases comment la reconnaître, puis donne 1 action immédiate à faire pour ne pas tomber dedans.`;
      dataBlock = `DONNÉES À UTILISER :
- Domaines suspects récurrents détectés par Despy (24h) : ${ctx.topDomains.length ? ctx.topDomains.map(d => `${d.dom} (${d.count} signalements)`).join(', ') : 'aucun cette semaine'}
- Alertes officielles récentes : ${ctx.nationalAlerts.length ? ctx.nationalAlerts.slice(0, 3).map(a => `"${a.title}" (${a.source})`).join(' | ') : 'aucune'}
- Total arnaques détectées dans la semaine : ${ctx.statsWeek.scams}`;
      break;

    case 'conseil-pratique':
      topic = `Conseil pratique de cybersécurité.
Mission : donner UN seul conseil concret, applicable en moins de 5 minutes par un senior.
Exemples acceptés : activer la double authentification (Gmail/Free/Orange), vérifier les appareils connectés, créer un mot de passe fort, repérer un lien suspect avant de cliquer, sauvegarder ses photos, sécuriser sa box internet.
Étapes numérotées 1-2-3, claires, sans jargon.`;
      dataBlock = `Choisis un conseil utile et de saison (date du jour : ${dateFr}).`;
      break;

    case 'bilan-semaine':
      topic = `Bilan hebdomadaire de la communauté Despy.
Mission : présenter en chiffres ce qui s'est passé cette semaine sur Despy, et terminer par une leçon que les lecteurs peuvent retenir.
Ton : factuel, valorisant la communauté qui se protège grâce aux signalements.`;
      dataBlock = `STATISTIQUES DE LA SEMAINE :
- Analyses de messages réalisées : ${ctx.statsWeek.total}
- Arnaques détectées : ${ctx.statsWeek.scams}
- Numéros suspects signalés : ${ctx.statsWeek.phones}
- Domaines récurrents : ${ctx.topDomains.slice(0, 3).map(d => d.dom).join(', ') || 'aucun'}
${ctx.nationalAlerts.length ? `- Alertes officielles : ${ctx.nationalAlerts.slice(0, 2).map(a => a.title).join(' | ')}` : ''}`;
      break;

    case 'quiz':
      topic = `Quiz du week-end — 1 seule question avec 3 choix de réponse (A, B, C).
Mission : poser une question sur une arnaque réelle ou un réflexe sécurité. Donner les 3 réponses possibles. Inviter à commenter sa réponse.
NE PAS donner la solution dans le post (on la révélera en commentaire plus tard).
Format : question claire + A) ... + B) ... + C) ... + "Votre réponse en commentaire 👇"`;
      dataBlock = `Sujet libre, choisis un thème actuel pertinent.`;
      break;

    case 'temoignage':
      topic = `Témoignage / cas réel d'arnaque évitée.
Mission : raconter une situation concrète (anonymisée) où un utilisateur Despy a évité une arnaque grâce à un réflexe simple.
Ton : narratif court, comme une mini-histoire, qui met en valeur le bon réflexe sans humilier la victime.
Fictif accepté, mais réaliste.`;
      dataBlock = `Exemples de scénarios courants pour t'inspirer (choisis-en UN) :
- Faux SMS Chronopost / La Poste demandant 1,99 €
- Appel d'un "conseiller bancaire" demandant un code SMS
- Email Ameli / CAF urgent avec lien suspect
- Faux profil sur Leboncoin demandant un acompte
- Arnaque au faux support Microsoft / Apple par téléphone
Inspire-toi des domaines récurrents détectés : ${ctx.topDomains.slice(0, 3).map(d => d.dom).join(', ') || '(rien à signaler)'}`;
      break;

    case 'rappel-securite':
      topic = `Rappel sécurité court et impactant pour le dimanche.
Mission : un message simple à retenir, formulé comme une "règle d'or" de la cybersécurité pour les seniors.
Format : 3 réflexes essentiels sous forme de courte liste (✅ ... ✅ ... ✅).
Idéal : on lit en 30 secondes le dimanche matin avec son café.`;
      dataBlock = `Choisis 3 réflexes essentiels et concrets.`;
      break;

    default:
      topic = `Post générique cybersécurité.`;
      dataBlock = ``;
  }

  return `${baseRules}

CONTEXTE :
Date du jour : ${dateFr}
Type de post demandé : ${postType}

THÈME :
${topic}

${dataBlock}

Rédige maintenant le post Facebook (texte brut, prêt à publier).`;
}

// ── Génération via Claude ────────────────────

async function generatePostContent(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  const res = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) throw new Error('Erreur Claude : ' + JSON.stringify(res.data));
  const content = res.data.content && res.data.content[0] && res.data.content[0].text;
  if (!content) throw new Error('Réponse Claude vide');
  return content.trim();
}

// ── Post sur Facebook ────────────────────────

async function publishToFacebook(message, pageToken) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const url = `${FB_GRAPH}/${pageId}/feed`;

  const params = new URLSearchParams();
  params.append('message', message);
  params.append('access_token', pageToken);

  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) throw new Error('Erreur Facebook : ' + JSON.stringify(res.data));
  return res.data; // { id: "PAGEID_POSTID" }
}

// ── Handler principal ────────────────────────

exports.handler = async (event) => {
  const isManual = event && event.httpMethod === 'POST';
  const isPreview = isManual && (event.queryStringParameters || {}).preview === '1';

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Permettre de forcer un type de post via query string en mode manuel
    let postType = getPostTypeForToday();
    if (isManual) {
      const qs = event.queryStringParameters || {};
      if (qs.type) postType = qs.type;
    }

    // 1. Récupère le contexte
    const ctx = await getContextData(supabase);

    // 2. Construit le prompt
    const prompt = buildPrompt(postType, ctx);

    // 3. Génère le post
    const postContent = await generatePostContent(prompt);

    // 4. Mode preview : on génère mais on ne publie pas
    if (isPreview) {
      await supabase.from('social_posts').insert({
        platform: 'facebook',
        post_type: postType,
        content: postContent,
        status: 'preview',
        created_at: new Date().toISOString()
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, postType, content: postContent })
      };
    }

    // 5. Récupère le Page Token (depuis cache ou nouveau)
    const pageToken = await getPageAccessToken(supabase);

    // 6. Publie
    const result = await publishToFacebook(postContent, pageToken);

    // 7. Log
    await supabase.from('social_posts').insert({
      platform: 'facebook',
      post_type: postType,
      content: postContent,
      facebook_post_id: result.id,
      status: 'published',
      created_at: new Date().toISOString()
    });

    console.log('✅ Post Facebook publié :', result.id, '| type:', postType);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, postId: result.id, postType, contentPreview: postContent.slice(0, 200) })
    };

  } catch (err) {
    console.error('❌ social-agent error:', err.message);
    // Log l'échec
    try {
      await supabase.from('social_posts').insert({
        platform: 'facebook',
        post_type: 'unknown',
        content: '(échec génération)',
        status: 'failed',
        error_message: err.message,
        created_at: new Date().toISOString()
      });
    } catch(e) {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
