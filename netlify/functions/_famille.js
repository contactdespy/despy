// ════════════════════════════════════════════
// DESPY — Offre Famille : savoir si un email est couvert par le plan d'un proche
// Module partagé (check-subscription, famille…), pas un endpoint.
//
// Un membre invité n'a pas d'abonnement à son nom : sa protection dépend
// entièrement de celle du payeur. On revérifie donc À CHAQUE FOIS que le
// payeur est bien toujours abonné à une formule Famille — si celui-ci résilie,
// la couverture des proches tombe d'elle-même, sans traitement à part.
// ════════════════════════════════════════════

const PLANS_FAMILLE = ['family_monthly', 'family_annual'];
const MAX_INVITES = 2;              // le payeur + 2 proches = 3 personnes

// Renvoie { couvert, owner, ownerPrenom } — dégrade en douceur si la table
// n'existe pas. Le prénom sert à l'affichage : « protégé par Yacine » vaut
// mieux qu'une adresse email, qu'on ne doit d'ailleurs pas étaler à l'écran.
async function couvertureFamille(supabase, email) {
  const vide = { couvert: false, owner: null, ownerPrenom: null };
  const em = (email || '').toLowerCase().trim();
  if (!em) return vide;

  try {
    const { data: lien, error } = await supabase
      .from('family_members')
      .select('owner_email')
      .eq('member_email', em)
      .eq('status', 'active')
      .maybeSingle();
    if (error || !lien) return vide;

    // Le payeur est-il TOUJOURS abonné, et à une formule Famille ?
    const { data: payeur } = await supabase
      .from('clients')
      .select('subscribed, plan, prenom, name')
      .eq('email', lien.owner_email)
      .maybeSingle();

    if (payeur && payeur.subscribed && PLANS_FAMILLE.includes(payeur.plan)) {
      const prenom = (payeur.prenom || (payeur.name || '').split(' ')[0] || '').trim();
      return { couvert: true, owner: lien.owner_email, ownerPrenom: prenom || null };
    }
    return vide;
  } catch (e) {
    console.warn('couvertureFamille:', e.message);
    return vide;
  }
}

// ── Ce qu'il manquait : que le reste du serveur le sache aussi ────────────
// Jusqu'ici, seul l'écran de connexion appelait couvertureFamille. Partout
// ailleurs on lisait `clients.subscribed`, qui est à false pour un proche —
// c'est le payeur qui porte l'abonnement. Le parent pour qui la famille paie
// butait donc sur le quota du chat, recevait les teasers au lieu des alertes,
// n'avait ni surveillance des fuites ni entraînement… et recevait « Dernière
// chance : 2 mois offerts ».
//
// Règle pour tout le serveur : « abonné » veut dire « a droit au service »,
// donc estCouvert / prochesCouverts. `subscribed` seul ne sert plus qu'à
// compter ceux qui PAIENT (admin, compteur public, Stripe).

// Une personne a-t-elle droit au service payant ? Oui si elle paie, oui si un
// proche paie pour elle.
async function estCouvert(supabase, client, email) {
  if (client && client.subscribed) return true;
  const em = email || (client && client.email);
  if (!em) return false;
  return (await couvertureFamille(supabase, em)).couvert;
}

// Tous les proches couverts à cet instant : lien actif ET payeur toujours
// abonné à une formule Famille. Deux requêtes pour tout le monde, pas une par
// proche — c'est ce que lisent les envois en lot.
//
// En cas de panne : ensemble vide, donc le comportement d'avant. Un proche
// qui rate un envoi, c'est un défaut ; un cron qui plante, c'est tout le
// monde qui rate l'envoi.
async function prochesCouverts(supabase) {
  try {
    const { data: liens, error } = await supabase
      .from('family_members')
      .select('member_email, owner_email')
      .eq('status', 'active');
    if (error || !liens || !liens.length) return new Set();

    const payeurs = [...new Set(liens.map((l) => (l.owner_email || '').toLowerCase()).filter(Boolean))];
    const { data: lus, error: e2 } = await supabase
      .from('clients')
      .select('email, subscribed, plan')
      .in('email', payeurs);
    if (e2 || !lus) return new Set();

    const valides = new Set(lus
      .filter((p) => p.subscribed && PLANS_FAMILLE.includes(p.plan))
      .map((p) => (p.email || '').toLowerCase()));
    return new Set(liens
      .filter((l) => l.member_email && valides.has((l.owner_email || '').toLowerCase()))
      .map((l) => l.member_email.toLowerCase()));
  } catch (e) {
    console.warn('prochesCouverts:', e.message);
    return new Set();
  }
}

// Pour un envoi réservé aux abonnés : ajoute aux lignes déjà lues les proches
// couverts, lus avec les mêmes colonnes (qui doivent contenir `email`).
// Options :
//   filtre(q) — remet sur la requête les conditions de l'appelant autres que
//               l'abonnement ; sans lui, un proche recevrait un envoi que
//               l'appelant réserve, par exemple, aux inscrits d'une commune.
//   parmi     — liste d'emails à laquelle l'appelant se limitait déjà.
//
// Les lignes ajoutées sont marquées subscribed:true et plan:'family_member',
// pour que la suite du code (choix du gabarit, affichage de la formule) les
// traite comme les abonnés qu'elles sont.
async function avecProches(supabase, lignes, colonnes, options) {
  const { filtre, parmi } = options || {};
  const base = lignes || [];
  const couverts = await prochesCouverts(supabase);
  if (!couverts.size) return base;
  const deja = new Set(base.map((l) => (l.email || '').toLowerCase()));
  const permis = parmi ? new Set(parmi.map((e) => (e || '').toLowerCase())) : null;
  const manquants = [...couverts].filter((e) => !deja.has(e) && (!permis || permis.has(e)));
  if (!manquants.length) return base;
  try {
    let q = supabase.from('clients').select(colonnes).in('email', manquants);
    if (filtre) q = filtre(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return base.concat((data || []).map((c) => ({ ...c, subscribed: true, plan: 'family_member' })));
  } catch (e) {
    console.warn('avecProches:', e.message);
    return base;
  }
}

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé
module.exports = {
  couvertureFamille, estCouvert, prochesCouverts, avecProches,
  PLANS_FAMILLE, MAX_INVITES, handler
};
