// ════════════════════════════════════════════
// DESPY — Score de sécurité + historique
// Netlify Function : /.netlify/functions/security-score
// Retourne le score et l'historique pour le dashboard
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

// ════════════════════════════════════════════
// LE SCORE DE SÉCURITÉ
//
// Il note l'état de protection RÉEL, pas la fidélité commerciale.
// Trois règles fermes :
//
//   1. L'abonnement ne rapporte AUCUN point. Il donne accès aux outils ;
//      c'est leur usage qui protège. L'ancien score offrait +20 pour le
//      seul fait de payer.
//   2. On ne récompense jamais l'ignorance. Tant qu'aucun contrôle des
//      fuites n'a eu lieu, le bloc « exposition » vaut 0 et le score est
//      plafonné : sans savoir ce qui circule, tout le reste est une
//      supposition. L'ancien score donnait les 25 points pleins à qui
//      n'avait jamais été vérifié — on atteignait 95/100 « Excellent »
//      sans la moindre vérification.
//   3. On ne compte que ce qu'on peut MESURER. Le bouclier téléphone est
//      utile mais rien ne l'enregistre : il ne rapporte donc rien, plutôt
//      que d'inventer un critère invérifiable.
//
// Chaque bloc est renvoyé au client avec son détail, pour qu'il puisse
// lire « il vous manque 20 points parce que personne ne veille sur vous »
// au lieu d'un chiffre opaque.
// ════════════════════════════════════════════

const JOUR = 24 * 60 * 60 * 1000;

function detailScore(client, extras) {
  const e = extras || {};
  const blocs = [];

  // ── 1. Exposition (35) — ce que le monde sait déjà de vous ──
  const controle = !!client.last_hibp_check;
  const fuites = client.breach_count || 0;
  const voles = Array.isArray(client.known_stealers) ? client.known_stealers.length
              : (client.known_stealers ? 1 : 0);
  let expo = 0, expoTxt;
  if (!controle) {
    expoTxt = 'Vos données n’ont jamais été vérifiées. On ne sait pas ce qui circule.';
  } else if (fuites === 0 && voles === 0) {
    expo = 35;
    expoTxt = 'Aucune fuite connue à ce jour.';
  } else {
    // Avoir vérifié vaut en soi : on garde 15 points même en cas de fuite.
    expo = 15 + Math.max(0, 20 - fuites * 7) - (voles > 0 ? 10 : 0);
    expo = Math.max(0, expo);
    expoTxt = voles > 0
      ? 'Un appareil infecté a été détecté : des mots de passe ont pu être volés.'
      : fuites + (fuites > 1 ? ' fuites concernent' : ' fuite concerne') + ' votre adresse.';
  }
  blocs.push({ cle: 'exposition', titre: 'Vos données exposées', points: expo, sur: 35,
               etat: expoTxt, action: controle ? (fuites ? 'darkweb' : null) : 'darkweb' });

  // ── 2. Filet de sécurité (20) — qui vous rattrape si vous tombez ──
  let filet = 0;
  const parts = [];
  if (client.trusted_contact_email) { filet += 14; parts.push('une personne de confiance veille sur vous'); }
  else parts.push('personne n’est prévenu si un danger vous vise');
  if (client.family_word) { filet += 6; parts.push('un mot de passe famille est convenu'); }
  else parts.push('aucun mot de passe famille contre les voix imitées');
  blocs.push({ cle: 'filet', titre: 'Votre filet de sécurité', points: filet, sur: 20,
               etat: parts.join(' · '), action: filet < 20 ? 'confiance' : null });

  // ── 3. Nettoyage (15) — réduire ce qui vous expose ──
  const rgpd = e.privacy ? 15 : 0;
  blocs.push({ cle: 'nettoyage', titre: 'Effacement de vos traces', points: rgpd, sur: 15,
               etat: rgpd ? 'Vos demandes de suppression sont parties.'
                          : 'Aucune demande d’effacement lancée.',
               action: rgpd ? null : 'privacy' });

  // ── 4. Vigilance (30) — savoir reconnaître, et s'être entraîné ──
  const modules = String(client.modules_done || '').split(',').filter(Boolean).length;
  const ptsMod = Math.min(20, modules * 2);
  const ptsEnt = Math.min(10, (e.entrainements || 0) * 5);
  blocs.push({ cle: 'vigilance', titre: 'Votre vigilance', points: ptsMod + ptsEnt, sur: 30,
               etat: modules + (modules > 1 ? ' modules faits' : ' module fait') +
                     ' · ' + (e.entrainements || 0) +
                     ((e.entrainements || 0) > 1 ? ' entraînements passés' : ' entraînement passé'),
               action: (ptsMod + ptsEnt) < 30 ? 'quiz' : null });

  let total = blocs.reduce((n, b) => n + b.points, 0);

  // Plafond tant que l'exposition est inconnue : sans elle, le reste n'est
  // qu'une supposition. On le dit au client plutôt que de le rassurer.
  const plafonne = !controle && total > 55;
  if (plafonne) total = 55;

  return { total: Math.max(0, Math.min(100, total)), blocs, controle, plafonne };
}

function computeScore(client, extras) { return detailScore(client, extras).total; }

function getScoreLabel(score, controle) {
  if (!controle) return { label: 'Protection incomplète', color: '#d97706', emoji: '⚠️' };
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

    // Cette fonction porte tout l'accueil : si une colonne récente manque en
    // base, on doit dégrader, pas renvoyer « Compte introuvable » et laisser
    // l'écran vide. On retente donc avec le jeu de colonnes historique.
    const COLONNES_BASE = 'subscribed, questions_used, breach_count, last_hibp_check, telephone, quizzes_completed, created_at, known_breaches, plan';
    const COLONNES_PLUS = COLONNES_BASE + ', trusted_contact_email, trusted_contact_name, chat_period, chat_period_used, family_word, modules_done, known_stealers';

    let { data: client, error } = await supabase
      .from('clients').select(COLONNES_PLUS).eq('email', cleanEmail).maybeSingle();
    if (error) {
      console.warn('security-score : colonnes récentes absentes, repli —', error.message);
      ({ data: client, error } = await supabase
        .from('clients').select(COLONNES_BASE).eq('email', cleanEmail).maybeSingle());
    }

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
    let nbTraining = 0;
    try {
      const { count: tc } = await supabase.from('training_tests')
        .select('id', { count: 'exact', head: true }).eq('email', cleanEmail);
      nbTraining = tc || 0;
      hasTraining = nbTraining > 0;
    } catch (e) { /* table absente → étape non faite */ }

    const checklist = {
      darkweb:    !!client.last_hibp_check,
      trusted:    !!client.trusted_contact_email,
      conseiller: (client.questions_used || 0) > 0,
      formation:  (client.quizzes_completed || 0) > 0,
      privacy:    hasPrivacy,
      training:   hasTraining,
    };

    const detail = detailScore(client, { privacy: hasPrivacy, entrainements: nbTraining });
    const score = detail.total;
    const { label, color, emoji } = getScoreLabel(score, detail.controle);

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
        // Le détail par bloc : c'est lui qui permet au client de lire
        // « il vous manque 20 points parce que personne ne veille sur vous »
        // au lieu d'un chiffre opaque.
        blocs: detail.blocs,
        controle: detail.controle,
        plafonne: detail.plafonne,
        label,
        color,
        emoji,
        tips: tips.slice(0, 3),
        checklist,
        stats: {
          questions_used:    client.questions_used || 0,
          // Le compteur affiché sous « Ce mois-ci » doit être MENSUEL.
          // `questions_used` est le cumul depuis l'inscription (gardé tel quel
          // car onboarding-sequence filtre dessus) : l'afficher sous un titre
          // mensuel donnait un chiffre faux qui ne redescendait jamais.
          questions_month:   (client.chat_period === new Date().toISOString().slice(0, 7))
                               ? (client.chat_period_used || 0) : 0,
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
