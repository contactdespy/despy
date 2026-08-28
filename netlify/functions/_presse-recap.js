// ════════════════════════════════════════════
// DESPY — Le récapitulatif de la veille presse
//
// UN email par passage du robot, pas un par article. Sur les flux réels, un
// passage propose jusqu'à dix articles : dix emails deux fois par jour, c'est
// une boîte saturée en trois jours et une validation qui n'est plus faite.
// Un seul message, chaque article avec ses deux boutons.
//
// Les liens sont signés (même HMAC que la modération des signalements) : ils
// arrivent dans une boîte mail, transitent par des serveurs qu'on ne maîtrise
// pas, et n'importe qui pourrait sinon publier ce qu'il veut sur l'appli en
// devinant un numéro de ligne.
// ════════════════════════════════════════════

const { signFinding } = require('./_privacy-sign');

const DESTINATAIRE = process.env.ALERTES_MODERATION_EMAIL || 'contact.despy@gmail.com';

function echapper(txt) {
  return String(txt || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lien(base, id, action) {
  return `${base}/.netlify/functions/alert-moderate`
    + `?a=${id}&d=${action}&k=${signFinding('alerte', id, action)}`;
}

// Un article = un bloc lisible en diagonale : le titre, le journal, la date,
// et les deux boutons. Le résumé n'est PAS repris : celui de Google Actualités
// ne contient que le titre du lien et le nom du journal, déjà affichés.
function bloc(base, a) {
  const publier = lien(base, a.id, 'publier');
  const rejeter = lien(base, a.id, 'rejeter');
  const local = (a.source || '').indexOf('locale') !== -1;
  const jour = (a.published || '').slice(0, 10);
  return `
    <div style="border:1px solid #e6ebf2;border-radius:12px;padding:16px;margin-bottom:14px">
      ${local ? '<div style="display:inline-block;background:#fff3cd;color:#8a6d00;font-size:11px;font-weight:800;'
              + 'padding:3px 9px;border-radius:20px;margin-bottom:8px">BAS-RHIN</div>' : ''}
      <div style="font-size:15px;font-weight:700;color:#0a1f3a;line-height:1.45">
        <a href="${echapper(a.url)}" style="color:#0a1f3a;text-decoration:none">${echapper(a.title)}</a>
      </div>
      <div style="font-size:12px;color:#8a93a0;margin:6px 0 12px">${echapper(a.source)}${jour ? ' · ' + jour : ''}</div>
      <a href="${publier}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;
         padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;margin-right:6px">✅ Publier</a>
      <a href="${rejeter}" style="display:inline-block;background:#eef1f5;color:#555;text-decoration:none;
         padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px">🚫 Rejeter</a>
    </div>`;
}

// `articles` : [{ id, title, source, url, published }] — déjà en base, statut
// 'a_valider'. Rien ici ne publie quoi que ce soit ; l'email ne fait que
// proposer.
async function envoyerRecapPresse(articles) {
  if (!articles || !articles.length) return { envoye: 0 };
  if (!process.env.RESEND_API_KEY) {
    // Dit à voix haute plutôt que silencieusement ignoré : sans email, les
    // articles restent invisibles pour toujours dans la file d'attente.
    console.error('[presse] RESEND_API_KEY absente — aucun récapitulatif possible');
    return { envoye: 0, probleme: 'cle_absente' };
  }

  const base = process.env.URL || 'https://despy.fr';
  const locaux = articles.filter(a => (a.source || '').indexOf('locale') !== -1).length;

  // L'objet doit se lire dans la liste des messages, sans l'ouvrir : le nombre
  // d'articles, et surtout s'il y a du local — c'est ce qui mérite qu'on
  // s'arrête tout de suite.
  const objet = locaux
    ? `📰 ${articles.length} article(s) à valider — dont ${locaux} du Bas-Rhin`
    : `📰 ${articles.length} article(s) de presse à valider`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Despy — Veille <contact@despy.fr>',
      to: [DESTINATAIRE],
      subject: objet,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#333;max-width:640px;margin:0 auto">
        <h2 style="color:#0a1f3a;font-size:19px;margin-bottom:4px">Veille presse — à valider</h2>
        <p style="font-size:13.5px;color:#666;line-height:1.6;margin-top:0">
          Ces articles ont été trouvés dans la presse et <strong>ne sont pas visibles</strong>
          dans l'application. Ils n'y paraîtront que si vous cliquez sur « Publier ».
          Sans clic, ils restent en attente et ne sont plus reproposés.
        </p>
        ${articles.map(a => bloc(base, a)).join('')}
        <p style="font-size:11.5px;color:#aaa;line-height:1.6;border-top:1px solid #eee;padding-top:12px">
          Sources officielles (CNIL, ANSSI, Cybermalveillance) : publiées automatiquement,
          elles n'apparaissent pas dans cette liste.
        </p>
      </div>`
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
  return { envoye: articles.length, locaux };
}

module.exports = { envoyerRecapPresse };
