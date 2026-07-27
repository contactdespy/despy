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

// Convertit le markdown **gras** en caractères Unicode bold sans sérif
// Fiable à 100% — pas de typos comme avec un LLM
const BOLD_MAP = (() => {
  const map = {};
  // Lettres majuscules A-Z → 𝗔-𝗭
  for (let i = 0; i < 26; i++) {
    map[String.fromCharCode(65 + i)] = String.fromCodePoint(0x1D5D4 + i);
    map[String.fromCharCode(97 + i)] = String.fromCodePoint(0x1D5EE + i);
  }
  // Chiffres 0-9 → 𝟬-𝟵
  for (let i = 0; i < 10; i++) {
    map[String(i)] = String.fromCodePoint(0x1D7EC + i);
  }
  return map;
})();

function toBoldUnicode(text) {
  let result = '';
  for (const ch of text) {
    result += BOLD_MAP[ch] || ch;
  }
  return result;
}

// Remplace **texte** par sa version Unicode bold
function markdownBoldToUnicode(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, (_, inner) => toBoldUnicode(inner));
}

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
// Refonte mai 2026 : passage de 7 posts/sem à 3 posts/sem
// Mardi  → scène vécue (storytelling humain)
// Jeudi  → chiffre choc (stat isolée + 1 phrase)
// Samedi → question directe (engagement commentaires)
// Le cron Netlify ne déclenche QUE ces 3 jours (cf. netlify.toml).
// Si appelé un autre jour (manuel), on retombe sur un fallback aléatoire.
function getPostTypeForToday() {
  const day = new Date().getDay(); // 0=dim, 2=mar, 4=jeu, 6=sam
  if (day === 2) return 'scene-vecue';
  if (day === 4) return 'chiffre-choc';
  if (day === 6) return 'question-directe';
  // Fallback (mode manuel hors créneau cron)
  const fallback = ['scene-vecue', 'chiffre-choc', 'question-directe'];
  return fallback[Math.floor(Math.random() * fallback.length)];
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

  // Stratégie CTA : on varie pour éviter la lassitude algorithmique
  // 33% sans CTA · 33% CTA discret · 33% CTA fort
  const ctaRoll = Math.random();
  const ctaStrategy = ctaRoll < 0.33 ? 'none' : (ctaRoll < 0.66 ? 'soft' : 'strong');

  const baseRules = `RÈGLES D'ÉCRITURE (à respecter STRICTEMENT) :
- Français parlé, vivant. Comme si tu parlais à un ami sénior au café.
- AUCUN jargon technique, AUCUN anglicisme inutile.
- Vouvoiement uniquement.
- Pas de markdown, pas de gras Unicode, pas de soulignement.
  → Texte naturel uniquement. Facebook récompense le contenu humain.
- Maximum 2 emojis pertinents dans tout le post. Zéro si possible.
- Longueur OBLIGATOIRE : 40 à 80 mots maximum. Pas plus.
  → Sur Facebook, l'engagement chute après 80 mots. Reste court.
- 1 SEULE idée par post. Pas d'accumulation, pas de liste à puces.
- N'invente JAMAIS de chiffres précis, dates ou noms.
  Si tu cites une victime fictive, dis-le clairement ou reste vague ("une dame", "un retraité").

TON ET STYLE :
- Direct, humain, parfois un peu rugueux.
- Évite TOUTES les formulations "marketing" type :
  ✗ "Despy vous protège" (creux)
  ✗ "Activez votre cybersécurité dès maintenant" (slogan publicitaire)
  ✗ "Ne soyez pas la prochaine victime" (alarmiste/cliché)
  ✗ "Despy est votre allié français contre les arnaques" (corporate)
- À la place, privilégie :
  ✓ Des phrases qui surprennent ("Hier, une dame de 78 ans m'a appelé en pleurs.")
  ✓ Des chiffres isolés qui frappent ("800 €. Voilà ce qu'une seule arnaque coûte en moyenne à un sénior.")
  ✓ Des questions qui font réagir ("Vous décrocheriez si votre banque vous appelait à 21h ?")
- Le post doit pouvoir être lu À HAUTE VOIX naturellement, sans buter.

MENTION DE DESPY :
${ctaStrategy === 'none'
  ? `- Pour ce post, NE MENTIONNE PAS Despy ni despy.fr du tout.
  → L'objectif est de créer du contenu de valeur pur, qui s'imprime dans l'esprit.
  → Les lecteurs reviendront naturellement vers vous pour le contenu suivant.`
  : ctaStrategy === 'soft'
  ? `- À la fin du post, ajoute UNE seule ligne discrète : "👉 Plus d'infos en commentaire" ou "👉 Comment se protéger : commentaires" ou similaire.
  → Le lien despy.fr sera posté en premier commentaire (logique Facebook).
  → Ne mets PAS le lien dans le corps du post (l'algorithme pénalise).`
  : `- À la fin du post, ajoute UN SEUL CTA simple et humain :
  Choisis UNE formulation parmi :
   - "Si vous voulez en parler, c'est sur despy.fr."
   - "Pour ceux qui veulent comprendre comment, despy.fr."
   - "On en parle ? despy.fr."
   - "Plus d'infos sur despy.fr — sans engagement."
  ÉVITE les CTA agressifs ("Vérifiez maintenant", "Activez", "Ne tardez pas").`
}

ANTI-PIÈGES IMPORTANTS :
- N'utilise JAMAIS de mise en page bullet/liste (Facebook tronque).
- N'utilise JAMAIS "selon une étude" sans source réelle.
- Ne dis JAMAIS "merci d'avoir lu" ou "n'hésitez pas à partager".

Renvoie UNIQUEMENT le texte du post Facebook, prêt à publier. Pas de balises markdown. Pas d'introduction. Pas de signature.`;

  let topic = '';
  let dataBlock = '';

  switch (postType) {

    case 'scene-vecue':
      topic = `FORMAT : Scène vécue / mini-histoire (storytelling humain).
Mission : raconter une scène CONCRÈTE, en 2-3 phrases, qui se passe dans la vraie vie.
Le but : faire dire au lecteur "C'EST EXACTEMENT CE QUI M'EST ARRIVÉ" ou "Ma mère/voisine vient de me raconter ça".

Modèles d'accroche (choisis-en un et adapte) :
- "Hier, une dame de [âge] m'a appelé en pleurs."
- "Ce matin, j'ai eu Mme [prénom fictif] au téléphone."
- "Un voisin de mon père m'a raconté ça la semaine dernière."
- "J'ai eu [X] appels comme celui-là cette semaine."

Puis, en 2 phrases : ce qui s'est passé + ce qui a fait basculer la situation (un détail qui aurait dû alerter, ou un réflexe qui a sauvé).

Pas de morale. Pas de leçon. Pas de "Despy aurait évité ça". Juste la scène.`;
      dataBlock = `Type d'arnaque possible (varie chaque semaine) : faux conseiller bancaire, faux SMS Chronopost/La Poste, arnaque "votre fils est en garde à vue", faux remboursement Ameli, faux site marchand.`;
      break;

    case 'chiffre-choc':
      topic = `FORMAT : Chiffre choc isolé (data-driven).
Mission : poser UN seul chiffre frappant en haut du post, isolé sur sa propre ligne, puis 2 phrases d'explication maximum.

Structure exacte demandée :
[CHIFFRE et unité, en gros]

[Phrase 1 : ce que ce chiffre signifie concrètement]
[Phrase 2 : pourquoi ça concerne le lecteur]

Exemples de chiffres possibles (utilise des sources crédibles, ANSSI / Cybermalveillance / études publiques) :
- "850 €" (montant moyen perdu par arnaque téléphonique en France, source Cybermalveillance)
- "1 senior sur 3" (proportion ayant été ciblée par une arnaque dans l'année)
- "12 minutes" (temps moyen pour vider un compte une fois le code SMS communiqué)
- "73 %" (taux de re-ciblage d'une victime dans les 6 mois suivants)

Le chiffre est l'accroche. Le reste est minimal.`;
      dataBlock = `Date du jour : ${dateFr}. Choisis un chiffre crédible. Si tu n'es pas sûr d'une source, reste vague ("plusieurs centaines d'euros en moyenne") plutôt que d'inventer.`;
      break;

    case 'question-directe':
      topic = `FORMAT : Question directe pour engagement commentaires.
Mission : poser une question simple qui invite le lecteur à RÉPONDRE en commentaire avec son vécu personnel.

La question doit être :
- Concrète (pas abstraite, pas philosophique)
- Universelle (95 % des seniors ont vécu ça)
- Sans piège ni jugement

Exemples de bonnes questions :
- "Combien de fois cette semaine avez-vous reçu un SMS qui dit 'votre colis est en attente, cliquez ici' ?"
- "Vous avez déjà raccroché au nez d'un conseiller bancaire qui demandait un code SMS ? Racontez."
- "Quel est le pire SMS d'arnaque que vous ayez reçu récemment ?"
- "À votre avis : que faut-il dire à un proche qui vient d'être arnaqué ?"

Format du post :
[Une phrase de mise en contexte ultra-courte]
[LA question, claire et directe]
[Invitation à commenter, très courte]

Pas de CTA Despy dans ce type de post (l'engagement organique se fait dans les commentaires).`;
      dataBlock = `Date : ${dateFr}. Choisis une question d'actualité (arnaques saisonnières si pertinent).`;
      break;

    default:
      topic = `Post court de cybersécurité, format libre. 40-80 mots maximum, ton humain.`;
      dataBlock = '';
  }

  return `${baseRules}

CONTEXTE :
- Date du jour : ${dateFr}
- Type de post demandé : ${postType}
- Stratégie CTA pour CE post : ${ctaStrategy}

THÈME :
${topic}

${dataBlock}

Rédige maintenant LE post Facebook (texte brut, 40-80 mots).`;
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
      model: 'claude-sonnet-4-5-20250929',
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
  // Publication automatique Facebook : uniquement sur déclenchement planifié.
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();

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

    // 3. Génère le post (refonte mai 2026 : texte naturel, sans markdown bold Unicode)
    //    Facebook pénalise les caractères Unicode bold (𝗧𝗲𝘅𝘁𝗲) considérés comme spammy.
    //    On garde le texte tel quel, ton humain.
    const rawContent = await generatePostContent(prompt);
    // Sécurité : si Claude renvoie du markdown malgré tout, on nettoie
    const postContent = rawContent
      .replace(/\*\*([^*]+)\*\*/g, '$1')   // **gras** → gras
      .replace(/__([^_]+)__/g, '$1')         // __souligné__ → souligné
      .trim();

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
