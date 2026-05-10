// ════════════════════════════════════════════
// DESPY — Proxy Chat IA
// Netlify Function : /.netlify/functions/despy-chat
// Bloque les comptes gratuits après 3 questions
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { messages, email } = JSON.parse(event.body || '{}');
    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Messages requis' }) };
    }

    // ── Vérification quota pour les comptes gratuits ──
    if (email) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

      const { data: client } = await supabase
        .from('clients')
        .select('plan, subscribed, questions_used')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();

      if (client && !client.subscribed) {
        const used = client.questions_used || 0;
        if (used >= 3) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              reply: "Vous avez utilisé vos 3 questions gratuites 😊 Pour continuer à bénéficier d'un accompagnement illimité, passez à l'abonnement Despy — **9,99€/mois** ou **89€/an** (2 mois offerts). Cliquez sur « Je m'abonne » pour continuer.",
              limit_reached: true,
              questions_used: used
            })
          };
        }

        // Incrémenter le compteur avant l'appel IA
        await supabase
          .from('clients')
          .update({ questions_used: used + 1, updated_at: new Date().toISOString() })
          .eq('email', email.toLowerCase().trim());
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
