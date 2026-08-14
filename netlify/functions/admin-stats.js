// ════════════════════════════════════════════
// DESPY — Tableau de bord patron
//
// Raison d'être : cette semaine, huit défauts ont été trouvés. AUCUN n'avait
// été signalé par un client. Le formulaire à 129 € était mort depuis trois
// mois, le parrainage n'avait jamais fonctionné. Personne ne pouvait le
// savoir : un échec silencieux n'a aucune conséquence tant qu'un humain ne
// se plaint pas — et à six clients, personne ne se plaint.
//
// Cette fonction répond à trois questions, dans cet ordre d'importance :
//   1. Qu'est-ce qui cloche AUJOURD'HUI ? (anomalies détectées sur les
//      données réelles — pas besoin d'un système de logs pour ça)
//   2. Que font vraiment les clients ?
//   3. Où en est le business ?
//
// Protection : jeton de session signé ET email dans ADMIN_EMAIL — le même
// double verrou que fb-admin. Connaître l'email admin ne suffit pas.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

const ADMIN_EMAILS = String(process.env.ADMIN_EMAIL || '')
  .split(',').map(e => e.toLowerCase().trim()).filter(Boolean);

function isAdmin(email) {
  if (!email || !ADMIN_EMAILS.length) return false;
  return ADMIN_EMAILS.includes(String(email).toLowerCase().trim());
}

const JOUR = 24 * 60 * 60 * 1000;
const ilYA = n => new Date(Date.now() - n * JOUR).toISOString();

// Compte une table sans en rapatrier le contenu. Renvoie null si la table
// n'existe pas, pour que le tableau affiche « — » au lieu d'un faux zéro.
async function compter(supabase, table, filtre) {
  try {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (filtre) q = filtre(q);
    const { count, error } = await q;
    return error ? null : (count || 0);
  } catch (e) { return null; }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}

  const auth = requireAuth(event, body, body.adminEmail, headers);
  if (!auth.ok) return auth.response;
  if (!isAdmin(body.adminEmail)) {
    return {
      statusCode: 403, headers,
      body: JSON.stringify({ error: 'Accès refusé', hint: 'La variable ADMIN_EMAIL sur Netlify doit contenir cet email.' })
    };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const moisCourant = new Date().toISOString().slice(0, 7);

    const { data: clients, error } = await supabase
      .from('clients')
      .select('email, prenom, name, plan, subscribed, created_at, password_hash, telephone, ' +
              'questions_used, chat_period, chat_period_used, quizzes_completed, modules_done, ' +
              'trusted_contact_email, breach_count, last_hibp_check, stripe_customer_id, referred_by');
    if (error) {
      console.error('admin-stats clients:', error.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lecture impossible' }) };
    }

    const tous = clients || [];
    const abonnes = tous.filter(c => c.subscribed);
    const depuis = (c, n) => c.created_at && c.created_at >= ilYA(n);

    // ── 1. CE QUI CLOCHE ────────────────────────────────────────────────
    // Chaque anomalie décrit un client réel qui vit un problème maintenant.
    const alertes = [];

    const sansMdp = abonnes.filter(c => !c.password_hash);
    if (sansMdp.length) alertes.push({
      gravite: 'haute',
      titre: sansMdp.length + ' abonné' + (sansMdp.length > 1 ? 's' : '') + ' sans mot de passe',
      quoi: 'Ils ont payé mais ne peuvent pas ouvrir l’application. Envoyez-leur un lien « mot de passe oublié ».',
      qui: sansMdp.map(c => c.email)
    });

    const sansTel = abonnes.filter(c => !c.telephone);
    if (sansTel.length) alertes.push({
      gravite: 'moyenne',
      titre: sansTel.length + ' abonné' + (sansTel.length > 1 ? 's' : '') + ' sans téléphone',
      quoi: 'Impossible de les rappeler — or la ligne SOS est la promesse centrale.',
      qui: sansTel.map(c => c.email)
    });

    const sansProche = abonnes.filter(c => !c.trusted_contact_email);
    if (sansProche.length) alertes.push({
      gravite: 'basse',
      titre: sansProche.length + ' abonné' + (sansProche.length > 1 ? 's' : '') + ' sans personne de confiance',
      quoi: 'Personne ne sera prévenu s’ils sont en difficulté. C’est le geste le plus utile à leur faire faire.',
      qui: sansProche.map(c => c.email)
    });

    const fuites = abonnes.filter(c => (c.breach_count || 0) > 0);
    if (fuites.length) alertes.push({
      gravite: 'moyenne',
      titre: fuites.length + ' abonné' + (fuites.length > 1 ? 's' : '') + ' avec des fuites connues',
      quoi: 'Un appel de votre part sur ce sujet précis vaut tous les emails.',
      qui: fuites.map(c => c.email + ' (' + c.breach_count + ')')
    });

    const abonnesInactifs = abonnes.filter(c =>
      !(c.chat_period === moisCourant && (c.chat_period_used || 0) > 0) &&
      !(c.quizzes_completed || 0) && !c.modules_done && !depuis(c, 14));
    if (abonnesInactifs.length) alertes.push({
      gravite: 'haute',
      titre: abonnesInactifs.length + ' abonné' + (abonnesInactifs.length > 1 ? 's' : '') + ' qui n’utilise rien',
      quoi: 'Ils paient sans se servir : ce sont les prochaines résiliations. Appelez-les.',
      qui: abonnesInactifs.map(c => c.email)
    });

    // Invitations Famille jamais acceptées — la place est payée pour rien.
    let famEnAttente = null;
    try {
      const { data: inv } = await supabase
        .from('family_members').select('owner_email, code, created_at')
        .eq('status', 'invited').lt('created_at', ilYA(10));
      famEnAttente = inv || [];
      if (famEnAttente.length) alertes.push({
        gravite: 'moyenne',
        titre: famEnAttente.length + ' invitation' + (famEnAttente.length > 1 ? 's' : '') + ' Famille sans réponse',
        quoi: 'Envoyées il y a plus de 10 jours. Le proche n’a probablement pas compris quoi faire du code.',
        qui: famEnAttente.map(i => i.owner_email + ' → ' + i.code)
      });
    } catch (e) {}

    // ── 2. CE QUI SE PASSE ──────────────────────────────────────────────
    const actifsCeMois = tous.filter(c => c.chat_period === moisCourant && (c.chat_period_used || 0) > 0);
    const usage = {
      questions_ce_mois: tous.reduce((n, c) => n + (c.chat_period === moisCourant ? (c.chat_period_used || 0) : 0), 0),
      clients_actifs_ce_mois: actifsCeMois.length,
      avec_personne_confiance: tous.filter(c => c.trusted_contact_email).length,
      formation_commencee: tous.filter(c => c.modules_done || (c.quizzes_completed || 0) > 0).length,
      modules_termines: tous.reduce((n, c) => n + String(c.modules_done || '').split(',').filter(Boolean).length, 0),
      sos_30j: await compter(supabase, 'sos_requests', q => q.gte('created_at', ilYA(30))),
      demandes_rgpd: await compter(supabase, 'privacy_requests'),
      signalements_arnaque: await compter(supabase, 'fraud_reports'),
      tests_entrainement: await compter(supabase, 'training_tests'),
      leads_guide: await compter(supabase, 'guide_leads'),
      // Ce que la publicité rapporte, et si elle rapporte ENCORE : un total
      // depuis toujours ne dit ni l'un ni l'autre.
      leads_pub: await compter(supabase, 'guide_leads', q => q.eq('source', 'facebook_ads')),
      leads_7j: await compter(supabase, 'guide_leads', q => q.gte('created_at', ilYA(7))),
      leads_pub_7j: await compter(supabase, 'guide_leads',
        q => q.eq('source', 'facebook_ads').gte('created_at', ilYA(7)))
    };

    // ── 3. LE BUSINESS ──────────────────────────────────────────────────
    const PRIX = { monthly: 9.99, annual: 89 / 12, family_monthly: 14.99, family_annual: 139 / 12 };
    const parPlan = {};
    abonnes.forEach(c => { parPlan[c.plan || '?'] = (parPlan[c.plan || '?'] || 0) + 1; });

    const business = {
      total_comptes: tous.length,
      abonnes: abonnes.length,
      gratuits: tous.length - abonnes.length,
      par_plan: parPlan,
      revenu_mensuel_estime: Math.round(abonnes.reduce((n, c) => n + (PRIX[c.plan] || 0), 0) * 100) / 100,
      inscrits_7j: tous.filter(c => depuis(c, 7)).length,
      inscrits_30j: tous.filter(c => depuis(c, 30)).length,
      abonnes_30j: abonnes.filter(c => depuis(c, 30)).length,
      parrainages_aboutis: tous.filter(c => c.referred_by).length
    };

    // Les dix derniers inscrits — pour voir qui arrive, et d'où.
    const derniers = tous
      .filter(c => c.created_at)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 10)
      .map(c => ({
        prenom: c.prenom || (c.name || '').split(' ')[0] || '—',
        email: c.email,
        plan: c.subscribed ? (c.plan || 'abonné') : 'gratuit',
        parraine: !!c.referred_by,
        le: c.created_at
      }));

    const ordre = { haute: 0, moyenne: 1, basse: 2 };
    alertes.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ genere_le: new Date().toISOString(), alertes, usage, business, derniers })
    };

  } catch (err) {
    console.error('admin-stats:', err && err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
