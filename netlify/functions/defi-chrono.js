// ════════════════════════════════════════════
// DESPY — Défi Chrono (quiz hebdomadaire)
// Netlify Function : /.netlify/functions/defi-chrono
// GET  : récupère le quiz de la semaine
// POST : soumet les réponses et enregistre le score
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// Pool de questions — tournent chaque semaine (semaine ISO % nb de questions)
const QUIZZES = [
  {
    id: 1,
    titre: "Reconnaître une arnaque",
    questions: [
      {
        q: "Vous recevez un SMS : « Votre colis La Poste est bloqué. Cliquez ici : lapost-livraison.com ». Que faites-vous ?",
        choices: ["Je clique pour récupérer mon colis", "J'ignore et je signale au 33700", "Je transmets à mes proches pour les prévenir", "Je rappelle le numéro indiqué"],
        correct: 1,
        explication: "Les vrais SMS La Poste n'incluent jamais de lien avec un domaine approximatif. Signalez au 33700 (SMS frauduleux)."
      },
      {
        q: "Un email de votre banque vous demande de « vérifier votre compte » en cliquant sur un lien. L'adresse email est : support@ma-banque-securite.com. Que faites-vous ?",
        choices: ["Je clique, ça vient de ma banque", "Je vérifie l'adresse de l'expéditeur — c'est suspect", "Je réponds avec mes identifiants", "Je transfère à mon conseiller"],
        correct: 1,
        explication: "Votre vraie banque utilise son propre domaine (ex: @bnpparibas.fr). Tout autre domaine est une tentative de phishing."
      },
      {
        q: "Quelqu'un vous appelle en se présentant comme un technicien Microsoft, disant que votre ordinateur est infecté. Que faites-vous ?",
        choices: ["Je lui donne accès à mon ordinateur", "Je raccroche immédiatement", "J'écoute ses instructions", "Je lui donne mon numéro de CB pour le paiement"],
        correct: 1,
        explication: "Microsoft, Apple ou votre opérateur ne vous appellent jamais spontanément pour un problème sur votre machine. C'est une arnaque au support technique."
      }
    ]
  },
  {
    id: 2,
    titre: "Mots de passe et comptes",
    questions: [
      {
        q: "Quel mot de passe est le plus sécurisé ?",
        choices: ["motdepasse123", "Azerty!2024", "J'aime-le-café-le-matin-42!", "MonNom1990"],
        correct: 2,
        explication: "Une longue phrase avec des mots aléatoires est bien plus difficile à craquer qu'un mot de passe court avec des caractères spéciaux."
      },
      {
        q: "Vous utilisez le même mot de passe pour votre email et votre banque. C'est :",
        choices: ["Pratique et sûr si c'est un bon mot de passe", "Dangereux — si un site est piraté, tous vos comptes sont compromis", "Acceptable si vous le changez chaque année", "Normal, tout le monde fait ça"],
        correct: 1,
        explication: "La réutilisation de mot de passe est la cause n°1 de piratage. Utilisez un gestionnaire de mots de passe (Bitwarden, Dashlane)."
      },
      {
        q: "La double authentification (2FA) par SMS est activée sur votre email. Si quelqu'un connaît votre mot de passe, peut-il se connecter ?",
        choices: ["Oui, le mot de passe suffit", "Non, il lui faut aussi votre téléphone", "Oui, il peut contourner le SMS", "Ça dépend de votre opérateur"],
        correct: 1,
        explication: "C'est précisément le but du 2FA — même avec votre mot de passe, l'attaquant ne peut pas se connecter sans accès physique à votre téléphone."
      }
    ]
  },
  {
    id: 3,
    titre: "Vie privée en ligne",
    questions: [
      {
        q: "Sur Facebook, vos publications sont visibles par « Tout le monde ». Qui peut les voir ?",
        choices: ["Seulement vos amis", "Vos amis et leurs amis", "N'importe qui sur internet, y compris les recruteurs et escrocs", "Uniquement les gens connectés à Facebook"],
        correct: 2,
        explication: "« Tout le monde » signifie internet entier, indexable par Google. Mettez vos publications en « Amis » au minimum dans Paramètres → Confidentialité."
      },
      {
        q: "Une application de lampe torche gratuite demande l'accès à vos contacts, votre localisation et votre microphone. Que faites-vous ?",
        choices: ["J'accepte tout, c'est gratuit donc normal", "Je refuse les permissions inutiles ou je cherche une autre appli", "Je n'utilise que le WiFi pour limiter les risques", "J'accepte, mais je désactive le WiFi"],
        correct: 1,
        explication: "Une lampe torche n'a besoin d'aucune de ces permissions. Des demandes excessives sont un signal d'application malveillante ou de collecte de données abusive."
      },
      {
        q: "Vous recevez un email vous demandant de « confirmer vos données personnelles » pour conserver votre compte Ameli. L'expéditeur est : ameli-confirmation@gmail.com. C'est :",
        choices: ["Légitime, Ameli utilise Gmail", "Une tentative de phishing — Ameli utilise @ameli.fr", "Un email automatique à ignorer", "Urgent, je dois répondre dans 24h"],
        correct: 1,
        explication: "Ameli.fr n'envoie jamais depuis @gmail.com. Tout organisme officiel (CAF, impôts, Ameli) utilise son propre domaine officiel."
      }
    ]
  }
];

function getWeeklyQuiz() {
  const weekNum = Math.ceil(new Date().getDate() / 7) + new Date().getMonth() * 5;
  return QUIZZES[weekNum % QUIZZES.length];
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const quiz = getWeeklyQuiz();

  // ── GET : récupérer le quiz (sans les réponses) ──
  if (event.httpMethod === 'GET') {
    const safeQuiz = {
      ...quiz,
      questions: quiz.questions.map(({ correct, explication, ...q }) => q)
    };
    return { statusCode: 200, headers, body: JSON.stringify(safeQuiz) };
  }

  // ── POST : soumettre les réponses ──
  if (event.httpMethod === 'POST') {
    try {
      const { email, answers, timeSeconds } = JSON.parse(event.body || '{}');

      if (!Array.isArray(answers) || answers.length !== quiz.questions.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Réponses invalides' }) };
      }

      // Calculer le score
      const results = quiz.questions.map((q, i) => ({
        correct:     answers[i] === q.correct,
        explication: q.explication,
        votre_reponse: quiz.questions[i].choices[answers[i]],
        bonne_reponse: quiz.questions[i].choices[q.correct]
      }));

      const correctCount = results.filter(r => r.correct).length;
      const total        = quiz.questions.length;
      const xp           = correctCount * 10 + (timeSeconds < 30 ? 15 : timeSeconds < 60 ? 10 : 5);

      // Sauvegarder si connecté
      if (email) {
        const { data: client } = await supabase
          .from('clients')
          .select('quizzes_completed')
          .eq('email', email.toLowerCase())
          .maybeSingle();

        if (client) {
          await supabase.from('clients').update({
            quizzes_completed: (client.quizzes_completed || 0) + 1,
            updated_at: new Date().toISOString()
          }).eq('email', email.toLowerCase());

          // Historique des quiz
          await supabase.from('quiz_history').insert({
            email:       email.toLowerCase(),
            quiz_id:     quiz.id,
            quiz_titre:  quiz.titre,
            score:       correctCount,
            total,
            xp_earned:   xp,
            time_seconds: timeSeconds || 0,
            created_at:  new Date().toISOString()
          });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          score: correctCount,
          total,
          xp,
          results,
          message: correctCount === total
            ? "Parfait ! Vous maîtrisez le sujet 🏆"
            : correctCount >= total / 2
            ? "Bien joué ! Quelques points à revoir."
            : "Entraînez-vous encore — c'est comme ça qu'on se protège !"
        })
      };

    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: '{}' };
};
