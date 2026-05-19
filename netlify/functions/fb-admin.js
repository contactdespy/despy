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

// ── Prompts Claude par catégorie ──
// Funnel à 2 étages : Groupe → Suivre la Page Despy (CTA primaire) → despy.fr (CTA secondaire)
// Le primaire est plus important : un follower de Page reçoit ensuite 30+ posts/mois auto.
const CATEGORY_PROMPTS = {
  'anti-arnaque': `Public : groupe Facebook "{group}" — communauté française qui partage des arnaques.
Mission : rédige un post Facebook de 130 à 180 mots qui partage UNE arnaque concrète + comment la reconnaître.
Structure : 🚨 accroche → description courte → 3 signes pour la repérer → 1 action immédiate.
Ton : utile, expert, jamais condescendant. Vouvoiement.

CTAs OBLIGATOIRES à intégrer en fin de post, dans cet ordre :
1. CTA PRINCIPAL — invite à suivre la page Facebook Despy pour recevoir les alertes chaque jour :
   "👉 Pour ne rater aucune nouvelle arnaque, suivez ma page Despy : ${DESPY_FB_PAGE_URL}"
2. CTA SECONDAIRE — mention discrète de despy.fr pour l'analyseur :
   "Vous pouvez aussi vérifier vos messages suspects sur despy.fr (gratuit)"`,

  'seniors': `Public : groupe Facebook "{group}" — seniors connectés français (60+).
Mission : rédige un post Facebook de 130 à 180 mots qui donne UN conseil pratique cybersécurité, applicable en 5 min par un senior.
Structure : 💡 accroche → pourquoi c'est important → 3 étapes numérotées concrètes.
Ton : pédagogique, bienveillant, jamais alarmiste. Vouvoiement. Pas de jargon non expliqué.

CTAs OBLIGATOIRES en fin de post :
1. CTA PRINCIPAL — invite à suivre la page Despy pour des conseils chaque jour :
   "👉 Pour un conseil cyber adapté chaque jour, suivez ma page Despy : ${DESPY_FB_PAGE_URL}"
2. CTA SECONDAIRE — Score Cyber gratuit :
   "Et si vous voulez tester votre niveau de sécurité, il y a un test gratuit (60 sec, sans inscription) sur despy.fr"`,

  'famille': `Public : groupe Facebook "{group}" — adultes 30-50 ans avec parents/grands-parents.
Mission : rédige un post Facebook de 130 à 180 mots qui touche le cœur : "Si vos parents reçoivent un SMS suspect, voici quoi faire / comment les protéger".
Structure : 👨‍👩‍👧 accroche émotionnelle → exemple parlant (anonymisé) → ce qu'il faut faire.
Ton : chaleureux, narratif, jamais commercial agressif.

CTAs OBLIGATOIRES en fin de post :
1. CTA PRINCIPAL — invite à suivre la page Despy pour partager aux parents :
   "👉 Pour des conseils à partager à vos proches, suivez la page Despy : ${DESPY_FB_PAGE_URL}"
2. CTA SECONDAIRE — cadeau d'abonnement :
   "Vous pouvez aussi leur offrir l'abonnement Despy (9,99€/mois) sur despy.fr — il y a même un code parrainage qui offre 1 mois aux 2"`,

  'local': `Public : groupe Facebook "{group}" — habitants de Strasbourg et Eurométropole.
Mission : rédige un post Facebook de 130 à 180 mots qui propose un SERVICE LOCAL d'intervention cybersécurité à domicile.
Structure : 📍 accroche locale → "Je m'appelle Yacine, je propose..." → 3 services concrets → tarifs (89€ pour 1h, 129€ pour 2h).
Ton : voisin sympa, professionnel, accessible. Première personne ("je").

CTAs OBLIGATOIRES en fin de post :
1. CTA PRINCIPAL — invite à suivre la page Despy pour rester informé :
   "👉 Suivez ma page Despy pour les actualités cyber : ${DESPY_FB_PAGE_URL}"
2. CTA SECONDAIRE — réservation directe :
   "Pour réserver un créneau à domicile, rendez-vous sur despy.fr (paiement sécurisé Stripe)"
3. Invitation à poser des questions en commentaire.`,

  'retraite': `Public : groupe Facebook "{group}" — retraités et préretraités intéressés par leur futur.
Mission : rédige un post Facebook de 150 à 200 mots, ton article éducatif, sur un thème cybersécurité de la retraite : protection des comptes bancaires en ligne, attention aux faux conseillers, sécurisation des données médicales en ligne.
Structure : 🛡 titre fort → contexte → conseils détaillés.
Ton : expert, factuel, posé. Format article long avec sauts de ligne.

CTAs OBLIGATOIRES en fin de post :
1. CTA PRINCIPAL — invite à suivre la page Despy pour des articles réguliers :
   "👉 Pour un article cyber complet chaque semaine, suivez ma page Despy : ${DESPY_FB_PAGE_URL}"
2. CTA SECONDAIRE — test gratuit :
   "Vous pouvez aussi tester votre niveau de protection en 60 secondes sur despy.fr"`
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
