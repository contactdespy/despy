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

// ── Prompts Claude par catégorie ──
const CATEGORY_PROMPTS = {
  'anti-arnaque': `Public : groupe Facebook "{group}" — communauté française qui partage des arnaques.
Mission : rédige un post Facebook de 130 à 180 mots qui partage UNE arnaque concrète + comment la reconnaître.
Structure : 🚨 accroche → description courte → 3 signes pour la repérer → 1 action immédiate → ressource utile (mention discrète : "vous pouvez vérifier vos messages sur despy.fr").
Ton : utile, expert, jamais condescendant. Vouvoiement. Pas de mention de Despy plus d'1 fois.`,

  'seniors': `Public : groupe Facebook "{group}" — seniors connectés français (60+).
Mission : rédige un post Facebook de 130 à 180 mots qui donne UN conseil pratique cybersécurité, applicable en 5 min par un senior.
Structure : 💡 accroche → pourquoi c'est important → 3 étapes numérotées concrètes → CTA discret vers le Score Cyber gratuit (60 sec, sans inscription) sur despy.fr.
Ton : pédagogique, bienveillant, jamais alarmiste. Vouvoiement. Pas de jargon non expliqué.`,

  'famille': `Public : groupe Facebook "{group}" — adultes 30-50 ans avec parents/grands-parents.
Mission : rédige un post Facebook de 130 à 180 mots qui touche le cœur : "Si vos parents reçoivent un SMS suspect, voici quoi faire / comment les protéger".
Structure : 👨‍👩‍👧 accroche émotionnelle → exemple parlant (anonymisé) → ce qu'il faut faire → CTA discret vers Despy (mention : "Vous pouvez offrir l'abonnement à un proche pour 9,99€/mois — il y a même un code parrainage qui offre 1 mois aux 2").
Ton : chaleureux, narratif, jamais commercial agressif.`,

  'local': `Public : groupe Facebook "{group}" — habitants de Strasbourg et Eurométropole.
Mission : rédige un post Facebook de 130 à 180 mots qui propose un SERVICE LOCAL d'intervention cybersécurité à domicile.
Structure : 📍 accroche locale → "Je m'appelle Yacine, je propose..." → 3 services concrets → tarifs (89€ pour 1h, 129€ pour 2h) → CTA pour réserver via despy.fr → encourager les questions en commentaire.
Ton : voisin sympa, professionnel, accessible. Première personne ("je").`,

  'retraite': `Public : groupe Facebook "{group}" — retraités et préretraités intéressés par leur futur.
Mission : rédige un post Facebook de 150 à 200 mots, ton article éducatif, sur un thème cybersécurité de la retraite : protection des comptes bancaires en ligne, attention aux faux conseillers, sécurisation des données médicales en ligne.
Structure : 🛡 titre fort → contexte → conseils détaillés → CTA discret vers despy.fr (test gratuit en 60 sec).
Ton : expert, factuel, posé. Format article long avec sauts de ligne.`
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

    // ── UPDATE_GROUP : modifie le statut/notes d'un groupe ──
    if (action === 'update_group') {
      const { groupId, updates } = body;
      if (!groupId || !updates) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Paramètres manquants' }) };

      const allowed = ['status', 'notes', 'facebook_url', 'joined_at'];
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
