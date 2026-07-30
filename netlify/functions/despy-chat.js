// ════════════════════════════════════════════
// DESPY — Proxy Chat IA
// Netlify Function : /.netlify/functions/despy-chat
// Comptes gratuits : 5 questions découverte PAR MOIS (remises à zéro le 1er).
// Les réponses verrouillées (playbooks « de l'argent est en jeu ») restent
// toujours accessibles et ne décomptent aucune question.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth, rateLimit } = require('./_auth');
const { matchPlaybook, buildPlaybookReply } = require('./_chat-playbooks');

// Quota découverte des comptes gratuits (aligné sur le quiz : 5/mois).
const FREE_CHAT_PAR_MOIS = 5;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { messages, email } = body;
    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Messages requis' }) };
    }

    // Le chat nécessite un compte connecté (jeton signé) — évite aussi
    // l'utilisation de notre clé Anthropic par des tiers.
    if (!email || !email.includes('@')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Connexion requise', code: 'AUTH_REQUIRED' }) };
    }
    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;

    // Garde-fou coût IA : 30 messages / heure / IP
    if (!rateLimit(event, 'chat', 30, 60 * 60 * 1000)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de messages d\'un coup. Réessayez dans quelques minutes.' }) };
    }

    // ── Réponses verrouillées : de l'argent est en jeu, on ne génère rien ──
    // Volontairement AVANT le quota : refuser de l'aide à quelqu'un qui se fait
    // voler en direct parce qu'il a épuisé ses 3 questions gratuites serait
    // indéfendable. Ces réponses ne coûtent rien (aucun appel à l'IA) et ne
    // décomptent pas de question.
    const dernier = [...messages].reverse().find((m) => m && m.role === 'user');
    const fiche = dernier && matchPlaybook(
      typeof dernier.content === 'string' ? dernier.content : ''
    );
    if (fiche) {
      console.log('playbook:', fiche.id);
      return { statusCode: 200, headers, body: JSON.stringify(buildPlaybookReply(fiche)) };
    }

    // ── Vérification quota pour les comptes gratuits ──
    // 5 questions découverte PAR MOIS, réellement remises à zéro le 1er.
    // `questions_used` reste le total cumulé (bilan, rapport mensuel,
    // onboarding-sequence) ; le quota vit dans chat_period/chat_period_used.
    if (email) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const em = email.toLowerCase().trim();
      const periode = new Date().toISOString().slice(0, 7);   // 'AAAA-MM'

      // Si la migration n'est pas passée, on retombe en douceur sur le
      // compteur cumulatif (pas de reset, mais aucun plantage).
      let avecPeriode = true;
      let res = await supabase
        .from('clients')
        .select('plan, subscribed, questions_used, chat_period, chat_period_used')
        .eq('email', em)
        .maybeSingle();
      if (res.error) {
        avecPeriode = false;
        res = await supabase
          .from('clients')
          .select('plan, subscribed, questions_used')
          .eq('email', em)
          .maybeSingle();
      }
      const client = res.data;

      if (client && !client.subscribed) {
        const used = avecPeriode
          ? (client.chat_period === periode ? (client.chat_period_used || 0) : 0)
          : (client.questions_used || 0);

        if (used >= FREE_CHAT_PAR_MOIS) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              reply: "Vous avez utilisé vos " + FREE_CHAT_PAR_MOIS + " questions découverte de ce mois-ci 😊 Elles se renouvellent le 1er du mois prochain.\n\nPour un accompagnement **illimité** tout de suite (et la ligne SOS avec un vrai conseiller au téléphone) : abonnement Despy — **9,99€/mois** ou **89€/an** (2 mois offerts).",
              limit_reached: true,
              questions_used: used,
              quota: FREE_CHAT_PAR_MOIS
            })
          };
        }

        // Incrémenter avant l'appel IA
        const patch = {
          questions_used: (client.questions_used || 0) + 1,
          updated_at: new Date().toISOString()
        };
        if (avecPeriode) { patch.chat_period = periode; patch.chat_period_used = used + 1; }
        await supabase.from('clients').update(patch).eq('email', em);
      }
    }

    // ── Appel API Anthropic ──
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `Tu es le Conseiller Despy, assistant numérique de confiance pour les particuliers français, spécialisé en cybersécurité et vie numérique.
Tu parles en français simple, sans jargon technique. Tu es bienveillant, patient et rassurant — comme un ami de confiance qui s'y connaît en informatique.
Tes réponses font 3-4 phrases maximum, claires et concrètes.

Tu aides avec TOUT ce qui concerne la vie numérique :
- Cybersécurité : arnaques SMS/email/téléphone, piratages, logiciels espions, mots de passe, dark web, virus
- Protection : que faire si on a été victime, comment signaler, comment se protéger
- Usage quotidien : WhatsApp, Facebook, email, smartphones, tablettes, ordinateurs
- Achats en ligne : comment acheter en sécurité, reconnaitre un site fiable, litiges
- Démarches numériques : impots.gouv.fr, ameli.fr, Mon Espace Santé, FranceConnect
- Applications : comment installer, utiliser, désinstaller une application
- Réseaux sociaux : paramètres de confidentialité, signaler un contenu, gérer son compte

Si la question sort completement du numérique (médecine, droit, finance) : réponds brièvement et suggère de consulter un professionnel.
Si la question est complexe ou urgente : propose l'abonnement Despy pour un accompagnement personnalisé (9,99€/mois ou 89€/an).
SIRET Despy : 103 694 212 00012.`,
        messages: messages.slice(-6),
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Anthropic error:', err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur IA' }) };
    }

    const data  = await response.json();
    const reply = data.content?.[0]?.text || "Je n'ai pas pu répondre. Réessayez.";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };

  } catch (err) {
    console.error('Chat error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
