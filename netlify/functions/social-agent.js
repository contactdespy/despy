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

  // Thèmes dominants — déduits par mots-clés. On ne transmet JAMAIS le texte
  // collé par les clients (données personnelles) : uniquement des comptages.
  const THEMES = {
    'colis / livraison':        /colis|livraison|chronopost|la ?poste|suivi/i,
    'faux conseiller bancaire': /banque|conseiller|virement|carte bancaire|code (?:sms|secret)/i,
    'impôts / administration':  /imp[oô]ts|dgfip|amendes?|antai|caf\b|ameli|assurance maladie/i,
    'compte à débloquer':       /compte (?:bloqu|suspendu|d[ée]sactiv)|r[ée]activ/i,
    'gain / loterie':           /gagn|loterie|tirage|cadeau|iphone gratuit/i,
    'proche en difficulté':     /maman|papa|fils|fille|nouveau num[ée]ro|whatsapp/i,
    'placement / crypto':       /placement|investi|crypto|bitcoin|rendement/i
  };
  const compte = {};
  (scams || []).forEach(r => {
    const t = (r.content || '');
    Object.keys(THEMES).forEach(k => { if (THEMES[k].test(t)) compte[k] = (compte[k] || 0) + 1; });
  });
  ctx.themes = Object.entries(compte).sort(([, a], [, b]) => b - a).slice(0, 3)
    .map(([nom, n]) => ({ nom, n }));

  // Signalements locaux publiés (Alerte Secteur) — commune + catégorie
  // uniquement : déjà publics sur la carte, modérés, jamais de nom.
  try {
    const { data: locaux } = await supabase
      .from('fraud_reports')
      .select('category, ville, created_at')
      .eq('status', 'published')
      .gte('created_at', weekAgo)
      .limit(20);
    ctx.locaux = locaux || [];
  } catch (e) { ctx.locaux = []; }

  return ctx;
}

// ── Prompts par type de post ─────────────────

function buildPrompt(postType, ctx) {
  const dateFr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // On varie la présence de Despy pour ne pas lasser (et parce qu'un post
  // sans marque est souvent celui qui porte le plus loin).
  const roll = Math.random();
  const cta = roll < 0.4 ? 'none' : (roll < 0.75 ? 'soft' : 'strong');

  // ── Ce que Despy a RÉELLEMENT observé. Seul matériau autorisé. ──
  const st = ctx.statsWeek || {};
  const lignes = [];
  if (st.total)   lignes.push(`- ${st.total} message(s) soumis à l'analyseur Despy cette semaine, dont ${st.scams || 0} identifié(s) comme arnaque.`);
  if (st.phones)  lignes.push(`- ${st.phones} numéro(s) signalé(s) par des membres cette semaine.`);
  if ((ctx.themes || []).length) {
    lignes.push(`- Thèmes d'arnaque les plus vus cette semaine : ` +
      ctx.themes.map(t => `${t.nom} (${t.n} cas)`).join(', ') + '.');
  }
  if ((ctx.topDomains || []).length) {
    lignes.push(`- Faux sites revenus plusieurs fois en 24 h : ` +
      ctx.topDomains.map(d => `${d.dom} (${d.count}×)`).join(', ') + '.');
  }
  if ((ctx.locaux || []).length) {
    const villes = {};
    ctx.locaux.forEach(l => { const k = l.ville || 'commune non précisée'; villes[k] = (villes[k] || 0) + 1; });
    lignes.push(`- Signalements locaux publiés : ` +
      Object.entries(villes).map(([v, n]) => `${v} (${n})`).join(', ') + '.');
  }
  if ((ctx.nationalAlerts || []).length) {
    lignes.push(`- Alertes nationales en cours : ` +
      ctx.nationalAlerts.slice(0, 3).map(a => `« ${a.title} »`).join(' ; ') + '.');
  }
  const donnees = lignes.length
    ? lignes.join('\n')
    : '(aucune donnée exploitable cette semaine)';

  const socle = `QUI PARLE
Tu écris à la place de Yacine, fondateur de Despy, à Strasbourg. Il se déplace
chez des particuliers — souvent des retraités — pour nettoyer leur téléphone,
sécuriser leurs comptes, et les aider quand ils se sont fait avoir.
Il écrit à la première personne. Il a des convictions et il les dit.
Son ennemi, ce sont les escrocs — JAMAIS les victimes. Il ne se moque jamais
de quelqu'un qui s'est fait piéger : ça peut arriver à tout le monde, et il
le pense vraiment.

HONNÊTETÉ — RÈGLE ABSOLUE, AUCUNE EXCEPTION
- N'invente JAMAIS : ni témoignage, ni prénom, ni âge, ni lieu, ni date,
  ni montant, ni pourcentage, ni source.
- Tu ne peux citer que ce qui figure dans DONNÉES RÉELLES ci-dessous.
- Interdit d'écrire « hier, une dame de 78 ans m'a appelé » : cet appel
  n'a pas eu lieu. Décris le SCHÉMA qui revient (c'est vrai) plutôt qu'une
  personne inventée (c'est faux) :
    OUI  « Le scénario qui revient le plus en ce moment, c'est celui-là. »
    NON  « Hier, une dame de 78 ans m'a appelé en pleurs. »
- Aucun chiffre qui ne vienne pas des DONNÉES RÉELLES. Jamais de
  « selon l'ANSSI » ou « selon Cybermalveillance » : tu n'as pas ces études.
- Une marque anti-arnaque qui invente des témoignages se détruit. C'est
  la règle la plus importante de toutes.

CE QUI FAIT QU'UN POST EST LU JUSQU'AU BOUT
Un post qui marche ouvre une boucle et la referme par une bascule.
On croit savoir → surprise → la raison, en une ligne.
Mécanique à imiter (surtout PAS à recopier) :
   Elle a raccroché.
   Elle a rappelé sa banque.
   Elle a fait exactement ce qu'il fallait faire.
   Elle a quand même tout perdu.
   Parce que le numéro qu'elle a rappelé, c'était celui qu'il lui avait donné.
Ce n'est pas le style qui compte, c'est la STRUCTURE : tension, puis bascule.
Un post qui dit tout dans la première phrase ne sera pas lu.

FORME
- Phrases courtes. Beaucoup de retours à la ligne : ça se lit sur un téléphone.
- 50 à 110 mots.
- Pas de markdown, pas de gras, pas de liste à puces. 1 emoji maximum, zéro de préférence.
- Vouvoiement.
- Pas de morale finale. Jamais « soyez vigilants », jamais « restez prudents ».
- Pas de formule marketing : « Despy vous protège », « votre allié », « dès maintenant » sont interdits.

MENTION DE DESPY
${cta === 'none'
  ? `- Ne mentionne ni Despy ni despy.fr. Ce post vaut pour lui-même.`
  : cta === 'soft'
  ? `- Termine par une ligne discrète : « 👉 J'explique comment en commentaire. »
  (le lien sera mis en premier commentaire — pas de lien dans le post)`
  : `- Termine par une seule phrase simple, au choix :
   « Si vous voulez en parler, c'est sur despy.fr. »
   « J'explique tout ça sur despy.fr. »
  Jamais d'injonction du type « vérifiez maintenant » ou « activez ».`}

DONNÉES RÉELLES (semaine du ${dateFr}) — ton seul matériau chiffré :
${donnees}`;

  let format;
  switch (postType) {

    case 'scene-vecue':
      format = `FORMAT : le détail qui change tout.
Choisis UN schéma d'arnaque présent dans les DONNÉES RÉELLES (ou, si elles
sont vides, un schéma que tout le monde connaît : faux SMS de colis, faux
conseiller bancaire).
Montre une personne qui fait les BONS gestes… et qui se fait avoir quand même.
Puis révèle en une seule ligne le détail qui a tout fait basculer.
Ne donne ni prénom ni âge inventé : dis « une personne », « un retraité »,
ou parle directement au « vous ».
Le lecteur doit se dire « j'aurais fait pareil ». C'est le but.`;
      break;

    case 'chiffre-choc':
      format = `FORMAT : ce qu'on a vraiment vu cette semaine.
Utilise UNIQUEMENT un chiffre présent dans les DONNÉES RÉELLES.
Structure :
   [le chiffre, seul sur sa ligne]
   [ce que ça veut dire concrètement]
   [le signe précis à repérer, en une phrase]
Si les DONNÉES RÉELLES ne contiennent aucun chiffre exploitable, n'invente
rien : écris à la place un post « le détail qui change tout » (voir l'autre
format) sans aucun chiffre.`;
      break;

    case 'question-directe':
      format = `FORMAT : la question qui fait répondre.
Ouvre par une micro-situation très concrète (2 lignes maximum), tirée des
DONNÉES RÉELLES si possible.
Puis UNE seule question, courte, à laquelle presque tout le monde a une
réponse vécue.
Termine par une invitation à répondre en commentaire, en quelques mots,
sans supplier ni mendier l'engagement.
Pas de mention de Despy dans ce format.`;
      break;

    default:
      format = `Post court, structure à bascule, 50-110 mots.`;
  }

  return `${socle}

FORMAT DEMANDÉ :
${format}

Rédige maintenant LE post Facebook. Texte brut uniquement, rien d'autre.`;
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
  const { isScheduled, notScheduled } = require('./_is-scheduled');

  const isManual  = event && event.httpMethod === 'POST';
  const veutVoir  = isManual && (event.queryStringParameters || {}).preview === '1';
  const secretOk  = process.env.INTERNAL_SECRET &&
    (event.headers || {})['x-internal-secret'] === process.env.INTERNAL_SECRET;

  // L'APERÇU ne publie rien : il génère le texte et le range en base pour
  // relecture. On l'autorise avec la clé interne, afin de pouvoir juger la
  // qualité d'un post AVANT qu'il ne parte sur la page.
  const isPreview = veutVoir && secretOk;

  // La PUBLICATION reste réservée au planificateur (ou à la clé interne).
  if (!isPreview && !isScheduled(event) && !secretOk) return notScheduled();

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
