// ════════════════════════════════════════════
// DESPY — Score de sécurité + historique
// Netlify Function : /.netlify/functions/security-score
// Retourne le score et l'historique pour le dashboard
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

function computeScore(client) {
  let score = 0;

  // Compte créé (+10)
  score += 10;

  // Abonné (+20)
  if (client.subscribed) score += 20;

  // A posé au moins une question (+15)
  if ((client.questions_used || 0) > 0) score += 15;

  // Aucune fuite dark web connue (+25), quelques fuites (-10 par fuite, min 0)
  const breaches = client.breach_count || 0;
  if (breaches === 0 && client.last_hibp_check) score += 25;
  else score += Math.max(0, 25 - breaches * 10);

  // Téléphone renseigné (+5)
  if (client.telephone) score += 5;

  // Quiz complétés (+5 par quiz, max 25)
  const quizzes = client.quizzes_completed || 0;
  score += Math.min(25, quizzes * 5);

  return Math.min(100, score);
}

function getScoreLabel(score) {
  if (score >= 80) return { label: 'Excellent', color: '#16a34a', emoji: '🛡️' };
  if (score >= 60) return { label: 'Bien protégé', color: '#2D5BFF', emoji: '✅' };
  if (score >= 40) return { label: 'À améliorer', color: '#d97706', emoji: '⚠️' };
  return { label: 'Vulnérable', color: '#dc2626', emoji: '🚨' };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { email } = body;
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }

    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const cleanEmail = email.toLowerCase().trim();
    const { data: client, error } = await supabase
      .from('clients')
      .select('subscribed, questions_used, breach_count, last_hibp_check, telephone, quizzes_completed, created_at, known_breaches, plan, trusted_contact_email, trusted_contact_name')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (error || !client) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Compte introuvable' }) };
    }

    // ── Checklist « Votre protection » (dashboard) ──
    // privacy_requests et training_tests : simple présence d'une ligne.
    // Best-effort : si une table manque, l'étape reste à faire (pas d'erreur).
    let hasPrivacy = false, hasTraining = false;
    try {
      const { count: pc } = await supabase.from('privacy_requests')
        .select('id', { count: 'exact', head: true }).eq('email', cleanEmail);
      hasPrivacy = (pc || 0) > 0;
    } catch (e) { /* table absente → étape non faite */ }
    try {
      const { count: tc } = await supabase.from('training_tests')
        .select('id', { count: 'exact', head: true }).eq('email', cleanEmail);
      hasTraining = (tc || 0) > 0;
    } catch (e) { /* table absente → étape non faite */ }

    const checklist = {
      darkweb:    !!client.last_hibp_check,
      trusted:    !!client.trusted_contact_email,
      conseiller: (client.questions_used || 0) > 0,
      formation:  (client.quizzes_completed || 0) > 0,
      privacy:    hasPrivacy,
      training:   hasTraining,
    };

    const score = computeScore(client);
    const { label, color, emoji } = getScoreLabel(score);

    // Conseils personnalisés selon le profil
    const tips = [];
    if ((client.breach_count || 0) > 0) tips.push({ priority: 'high', text: 'Changez vos mots de passe — votre email est dans des fuites de données' });
    if (!client.subscribed) tips.push({ priority: 'medium', text: 'Activez la surveillance dark web mensuelle avec l\'abonnement' });
    if ((client.questions_used || 0) === 0) tips.push({ priority: 'low', text: 'Posez votre première question au Conseiller Despy' });
    if (!client.telephone) tips.push({ priority: 'low', text: 'Ajoutez votre numéro pour recevoir des alertes SMS urgentes' });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        score,
        label,
        color,
        emoji,
        tips: tips.slice(0, 3),
        checklist,
        stats: {
          questions_used:    client.questions_used || 0,
          breach_count:      client.breach_count || 0,
          last_hibp_check:   client.last_hibp_check || null,
          quizzes_completed: client.quizzes_completed || 0,
          member_since:      client.created_at,
          // Qui veille sur le client — affiché dans l'onglet Protection une
          // fois les six gestes faits, pour que « protégé » ait un visage.
          trusted_name:      client.trusted_contact_name || null,
          trusted_email:     client.trusted_contact_email || null,
          plan:              client.subscribed ? client.plan : 'free',
        }
      })
    };

  } catch (err) {
    console.error('Security score error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
