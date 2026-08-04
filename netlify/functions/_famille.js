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

// Renvoie { couvert, owner } — dégrade en douceur si la table n'existe pas.
async function couvertureFamille(supabase, email) {
  const vide = { couvert: false, owner: null };
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
      .select('subscribed, plan')
      .eq('email', lien.owner_email)
      .maybeSingle();

    if (payeur && payeur.subscribed && PLANS_FAMILLE.includes(payeur.plan)) {
      return { couvert: true, owner: lien.owner_email };
    }
    return vide;
  } catch (e) {
    console.warn('couvertureFamille:', e.message);
    return vide;
  }
}

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé
module.exports = { couvertureFamille, PLANS_FAMILLE, MAX_INVITES, handler };
