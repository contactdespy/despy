// ════════════════════════════════════════════
// DESPY — « Repéré par Despy »
//
// Ce que Despy repère, montré au client. Il n'y a rien à inventer : chaque
// ligne correspond à un événement qui a eu lieu.
//
//   - les arnaques que CE client nous a montrées (analyses_history, verdict
//     « scam ») : la seule chose que Despy ait repérée « pour lui » ;
//   - le total réel de ces verdicts chez tous les membres ;
//   - les alertes publiées (list-alerts), chacune nommée selon ce qu'elle
//     est vraiment : une vague détectée chez les membres, une arnaque de
//     saison annoncée avant le pic, ou une alerte relevée par la veille
//     auprès d'une source officielle ou de la presse.
//
// Jamais « bloquée » ni « interceptée » : Despy ne bloque rien.
// ════════════════════════════════════════════

const JOURS_PERSO = 90;
const MAX_PERSO = 3;

// Les essais de l'équipe gonfleraient un total affiché comme réel. Même
// variable et même lecture que admin-stats.js.
function emailsAdmin() {
  return String(process.env.ADMIN_EMAIL || '')
    .split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
}

// Le début du message, sur une ligne. Le client relit SON message : rien
// d'autre que ce qu'il nous a lui-même envoyé.
function extrait(contenu) {
  const t = String(contenu || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 120) return t;
  const coupe = t.slice(0, 119);
  const espace = coupe.lastIndexOf(' ');
  return (espace > 80 ? coupe.slice(0, espace) : coupe).replace(/[\s,;:.–—-]+$/, '') + '…';
}

// `null` si la base ne répond pas : l'écran n'affiche alors rien, plutôt
// qu'un fil vide qui laisserait croire qu'il n'y a jamais rien eu.
async function reperesDuClient(supabase, email, maintenant) {
  try {
    const depuis = new Date((maintenant || new Date()).getTime() - JOURS_PERSO * 86400000).toISOString();
    const { data, error } = await supabase.from('analyses_history')
      .select('content, created_at')
      .eq('email', email).eq('verdict', 'scam').gte('created_at', depuis)
      .order('created_at', { ascending: false }).limit(MAX_PERSO);
    if (error || !Array.isArray(data)) return null;
    return data.map(r => ({ extrait: extrait(r.content), at: r.created_at }));
  } catch (e) { return null; }
}

async function arnaquesChezLesMembres(supabase) {
  try {
    let q = supabase.from('analyses_history')
      .select('id', { count: 'exact', head: true })
      .eq('verdict', 'scam').not('email', 'is', null);
    const admins = emailsAdmin();
    if (admins.length) q = q.not('email', 'in', '(' + admins.map(e => '"' + e.replace(/"/g, '') + '"').join(',') + ')');
    const { count, error } = await q;
    return error || typeof count !== 'number' ? null : count;
  } catch (e) { return null; }
}

// Même lecture des sources que alerteCard() dans l'appli.
function natureAlerte(source) {
  const s = String(source || '');
  if (s.indexOf('Anticipation') !== -1) return 'saison';
  if (s.indexOf('Despy') !== -1) return 'vague';
  return 'veille';
}

// Le texte de la notification d'une alerte publiée. Le titre dit ce que
// Despy a fait, le corps dit l'arnaque.
function textePush(alerte) {
  const nature = natureAlerte(alerte.source);
  const titre = nature === 'vague' ? 'Détecté chez les membres Despy'
    : nature === 'saison' ? 'Arnaque de saison, anticipée par Despy'
    : 'Repéré par Despy';
  const source = String(alerte.source || '').split(' · ')[0].trim();
  let corps = String(alerte.title || 'Alerte arnaque');
  if (nature === 'veille' && source) corps += ' (' + source + ')';
  return { title: '🛡️ ' + titre, body: corps.length > 180 ? corps.slice(0, 177) + '…' : corps };
}

module.exports = { reperesDuClient, arnaquesChezLesMembres, natureAlerte, textePush, extrait, JOURS_PERSO, MAX_PERSO };
