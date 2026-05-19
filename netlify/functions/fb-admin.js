// ════════════════════════════════════════════
// DESPY — Admin Dashboard Facebook Groupes
// Actions : list, generate_post, log_post, update_group, today_suggestion
// Auth : email du caller doit matcher ADMIN_EMAIL (env var)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// Accepte plusieurs emails admin séparés par virgules : ADMIN_EMAIL="x@a.fr,y@b.com"
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '')
  .split(',')
  .map(e => e.toLowerCase().trim())
  .filter(Boolean);

function isAdmin(email) {
  if (!email) return false;
  if (!ADMIN_EMAILS.length) return false;
  return ADMIN_EMAILS.includes(String(email).toLowerCase().trim());
}

// ── URL de la Page Facebook Despy (pour CTA dans les posts groupes) ──
const DESPY_FB_PAGE_URL = process.env.FACEBOOK_PAGE_URL || '';

// Intro chaleureuse partagée par toutes les catégories (humanise le post)
const PERSONAL_INTRO_RULE = `IMPORTANT — INTRO DE PRÉSENTATION :
Commence TOUJOURS par 1 phrase courte (max 12 mots) qui présente Yacine de façon chaleureuse et humaine, suivie d'un saut de ligne avant le contenu.
Varie la formulation à chaque post pour éviter la répétition. Exemples possibles (choisis-en un et adapte) :
- "Bonjour à tous, Yacine ici 👋"
- "Bonjour, je suis Yacine, créateur de Despy."
- "Yacine ici, je m'occupe de cybersécurité pour les particuliers."
- "Bonjour à toutes et tous, c'est Yacine."
- "Bonjour, Yacine de Despy — petit conseil du jour 👇"
- "Bonjour à tous ! Yacine de Despy."`;

// ── Prompts Claude par catégorie ──
// Posts COURTS (60-100 mots) pour maximiser l'engagement sur Facebook.
// Funnel à 2 étages : Groupe → Page Despy (CTA primaire) → despy.fr (secondaire)
const CATEGORY_PROMPTS = {

const CATEGORY_PROMPTS = {
  'anti-arnaque': `Public : groupe Facebook "{group}" — communauté française qui partage des arnaques.
Mission : rédige un post Facebook COURT (70 à 100 mots maximum) qui alerte sur UNE arnaque.

${PERSONAL_INTRO_RULE}

Structure complète :
1. Intro perso (1 phrase + saut de ligne)
2. 🚨 accroche en 1 phrase choc
3. 2-3 lignes : décrire l'arnaque + 2 signes pour la repérer (format liste à puces ✅/❌)
4. 1 ligne d'action concrète
Ton : direct, percutant. Pas de blabla. Vouvoiement.

CTAs OBLIGATOIRES à la fin (1 ligne chacun, séparés par 1 saut de ligne) :
- "👉 Suivez ma page Despy : ${DESPY_FB_PAGE_URL}"
- "Vérifiez vos messages sur despy.fr"`,

  'seniors': `Public : groupe Facebook "{group}" — seniors connectés français (60+).
Mission : rédige un post Facebook COURT (70 à 100 mots maximum) avec UN seul conseil cyber concret.

${PERSONAL_INTRO_RULE}

Structure complète :
1. Intro perso (1 phrase + saut de ligne)
2. 💡 accroche en 1 phrase (question ou affirmation)
3. 3 étapes numérotées 1️⃣ 2️⃣ 3️⃣ (1 ligne chacune, max 12 mots/étape)
4. 1 phrase de conclusion rassurante
Ton : pédagogique, simple. Vouvoiement. Zéro jargon non expliqué.

CTAs OBLIGATOIRES à la fin :
- "👉 Suivez ma page Despy : ${DESPY_FB_PAGE_URL}"
- "Test gratuit en 60 sec sur despy.fr"`,

  'famille': `Public : groupe Facebook "{group}" — adultes 30-50 ans avec parents/grands-parents.
Mission : rédige un post Facebook COURT (80 à 110 mots maximum) qui touche le cœur.

${PERSONAL_INTRO_RULE}

Structure complète :
1. Intro perso (1 phrase + saut de ligne)
2. 👨‍👩‍👧 accroche émotionnelle en 1 phrase (parle aux proches)
3. 2-3 lignes : exemple bref (anonymisé) + ce qu'il faut faire
4. 1 ligne rassurante
Ton : chaleureux, jamais commercial agressif.

CTAs OBLIGATOIRES à la fin :
- "👉 Suivez la page Despy : ${DESPY_FB_PAGE_URL}"
- "Offrez Despy à un proche (9,99€/mois, 1 mois offert avec parrainage) sur despy.fr"`,

  'local': `Public : groupe Facebook "{group}" — habitants de Strasbourg et Eurométropole.
Mission : rédige un post Facebook COURT (80 à 110 mots maximum) qui propose un service local d'intervention cyber.

INTRO LOCALE OBLIGATOIRE (et non l'intro standard) :
Commence par 1 phrase qui se présente comme local : "Bonjour à tous, je m'appelle Yacine, j'habite Strasbourg." ou "Bonjour à tous, Yacine ici, votre voisin strasbourgeois." (varie à chaque génération).

Structure complète :
1. Intro locale (1 phrase + saut de ligne)
2. 📍 accroche locale en 1 phrase
3. 2 lignes : "Je propose [services en 1 phrase]"
4. 1 ligne tarifs : "89€ (1h) ou 129€ (2h) selon vos besoins"
Ton : voisin sympa, première personne ("je").

CTAs OBLIGATOIRES à la fin :
- "👉 Suivez ma page Despy : ${DESPY_FB_PAGE_URL}"
- "Réservation en ligne sur despy.fr"
- 1 ligne d'invitation à poser des questions en commentaire.`,

  'retraite': `Public : groupe Facebook "{group}" — retraités et préretraités.
Mission : rédige un post Facebook COURT (90 à 130 mots maximum) sur un thème cyber/retraite.

${PERSONAL_INTRO_RULE}

Structure complète :
1. Intro perso (1 phrase + saut de ligne)
2. 🛡 titre fort en 1 phrase
3. 3-4 lignes : conseil clé en quelques phrases courtes
4. 1 ligne d'action concrète
Ton : expert, factuel, posé. Pas trop long.

CTAs OBLIGATOIRES à la fin :
- "👉 Suivez ma page Despy : ${DESPY_FB_PAGE_URL}"
- "Test de sécurité gratuit (60 sec) sur despy.fr"`
};

async function generatePostForGroup(group, ctx = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  const dateFr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const basePrompt = CATEGORY_PROMPTS[group.category] || CATEGORY_PROMPTS['anti-arnaque'];
  const prompt = basePrompt.replace('{group}', group.name)
    + `\n\nDate du jour : ${dateFr}`
    + `\n\nRègles strictes :`
    + `\n- Pas de markdown (Facebook ne le supporte pas, sauf émojis)`
    + `\n- Pas plus de 4 émojis dans tout le post`
    + `\n- Vouvoiement uniquement`
    + `\n- Pas de fautes`
    + `\n- Termine par 1 ligne d'invitation à commenter ou poser des questions`
    + `\n\nRenvoie UNIQUEMENT le texte du post, prêt à copier-coller. Pas d'intro de ta part.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Erreur Claude : ' + JSON.stringify(data));
  const text = data.content && data.content[0] && data.content[0].text;
  if (!text) throw new Error('Réponse Claude vide');
  return text.trim();
}

// ── Suggestion du jour ──
// Mapping jour de la semaine → catégorie recommandée
function todayCategorySuggestion() {
  const day = new Date().getDay(); // 0=dim, 1=lun, ...
  const map = {
    0: 'retraite',     // Dimanche : article long
    1: 'anti-arnaque', // Lundi : alerte de la semaine
    2: 'seniors',      // Mardi : conseil pratique
    3: null,           // Mercredi : engagement (commentaires uniquement)
    4: 'local',        // Jeudi : service local
    5: 'famille',      // Vendredi : cadeau / parrainage
    6: null            // Samedi : repos
  };
  return map[day];
}

// ── Handler ──────────────────────────────────

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}

  if (!isAdmin(body.adminEmail)) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({
        error: 'Accès admin refusé',
        hint: 'Vérifie que la variable ADMIN_EMAIL sur Netlify contient bien ton email de session.'
      })
    };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const action = body.action;

  try {
    // ── LIST : récupère tous les groupes ──
    if (action === 'list') {
      const { data, error } = await supabase
        .from('fb_groups')
        .select('*')
        .order('category')
        .order('estimated_size', { ascending: false });
      if (error) throw error;

      const todayCat = todayCategorySuggestion();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          groups: data || [],
          today: {
            date: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
            category: todayCat,
            isRestDay: !todayCat
          }
        })
      };
    }

    // ── GENERATE_POST : génère un post Claude pour un groupe ──
    if (action === 'generate_post') {
      const groupId = body.groupId;
      if (!groupId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'groupId manquant' }) };

      const { data: group } = await supabase.from('fb_groups').select('*').eq('id', groupId).single();
      if (!group) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Groupe introuvable' }) };

      const post = await generatePostForGroup(group);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ post, group: { id: group.id, name: group.name, category: group.category } })
      };
    }

    // ── UPDATE_GROUP : modifie un groupe ──
    if (action === 'update_group') {
      const { groupId, updates } = body;
      if (!groupId || !updates) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Paramètres manquants' }) };

      const allowed = ['name', 'category', 'estimated_size', 'status', 'notes', 'facebook_url', 'joined_at'];
      const clean = {};
      for (const k of allowed) if (k in updates) clean[k] = updates[k];

      // Si on passe à 'joined' et joined_at vide, on remplit
      if (clean.status === 'joined' && !clean.joined_at) {
        const { data: g } = await supabase.from('fb_groups').select('joined_at').eq('id', groupId).single();
        if (g && !g.joined_at) clean.joined_at = new Date().toISOString();
      }

      const { error } = await supabase.from('fb_groups').update(clean).eq('id', groupId);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── ADD_GROUP : ajoute un nouveau groupe ──
    if (action === 'add_group') {
      const { name, category, facebook_url, estimated_size } = body;
      if (!name || !category) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nom et catégorie requis' }) };
      const validCat = ['anti-arnaque', 'seniors', 'famille', 'local', 'retraite'];
      if (!validCat.includes(category)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Catégorie invalide' }) };

      const { data, error } = await supabase.from('fb_groups').insert({
        name: name.trim(),
        category,
        facebook_url: facebook_url || null,
        estimated_size: estimated_size ? parseInt(estimated_size, 10) : null,
        status: 'pending_join'
      }).select().single();
      if (error) {
        if (String(error.message || '').includes('duplicate')) {
          return { statusCode: 409, headers, body: JSON.stringify({ error: 'Un groupe avec ce nom existe déjà' }) };
        }
        throw error;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, group: data }) };
    }

    // ── DELETE_GROUP : supprime un groupe (et ses posts associés via ON DELETE CASCADE) ──
    if (action === 'delete_group') {
      const { groupId } = body;
      if (!groupId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'groupId manquant' }) };

      const { error } = await supabase.from('fb_groups').delete().eq('id', groupId);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── LOG_POST : enregistre qu'un post a été publié ──
    if (action === 'log_post') {
      const { groupId, content, notes } = body;
      if (!groupId || !content) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Paramètres manquants' }) };

      await supabase.from('fb_group_posts').insert({
        group_id: groupId,
        content,
        notes: notes || null,
        posted_at: new Date().toISOString()
      });

      // Mise à jour du groupe (last_post_at + posts_count++)
      const { data: g } = await supabase.from('fb_groups').select('posts_count').eq('id', groupId).single();
      const currentCount = (g && g.posts_count) || 0;
      await supabase.from('fb_groups').update({
        last_post_at: new Date().toISOString(),
        posts_count: currentCount + 1
      }).eq('id', groupId);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── POSTS_HISTORY : historique des posts d'un groupe ──
    if (action === 'posts_history') {
      const { groupId } = body;
      const q = supabase.from('fb_group_posts').select('*').order('posted_at', { ascending: false }).limit(20);
      if (groupId) q.eq('group_id', groupId);
      const { data } = await q;
      return { statusCode: 200, headers, body: JSON.stringify({ posts: data || [] }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue : ' + action }) };

  } catch (err) {
    console.error('fb-admin error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
