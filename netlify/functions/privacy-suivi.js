// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : « y figurez-vous encore ? »
// Cron : chaque jour à 8 h UTC → 0 8 * * * (voir netlify.toml)
//
// Un mois après une lettre, l'annuaire devait avoir répondu et supprimé.
// Despy ne peut pas le vérifier à la place du client : on lui écrit, avec
// l'endroit où chercher son nom et deux boutons. Sa réponse fait avancer la
// demande (privacy-suivi-reponse.js) : « je n'y suis plus » la clôt,
// « j'y suis encore » fait partir la relance. Personne n'a rien à faire à la
// main, et l'espace client cesse d'afficher « en cours » pour toujours.
//
// Une question par étape, jamais de rappel : un client qui ne répond pas
// n'est pas relancé tous les jours. Chaque jour plutôt que chaque mois, parce
// qu'une lettre partie le 2 n'a pas un mois le 1er suivant — elle aurait
// attendu soixante jours.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { isScheduled, notScheduled } = require('./_is-scheduled');
const { ecrire, lire, alerterAdmin } = require('./_db');
const { annuaire, dernieres, etapeDue, lienReponse } = require('./_privacy-suivi');

// Une fonction planifiée est coupée à 30 secondes. Le reste part le lendemain :
// rien n'est perdu, la ligne reste « à demander » tant que l'email n'est pas parti.
const MAX_CLIENTS = 15;

const jour = (d) => new Date(d).toLocaleDateString('fr-FR');

function emailHTML(prenom, email, dues, base) {
  const blocs = dues.map(({ ligne, etape }) => {
    const b = annuaire(ligne.broker_id);
    const ou = b.verif.map((v) =>
      `<a href="${v.url}" style="color:#1a3fd9;font-weight:700">${v.nom}</a>`).join(' &nbsp;·&nbsp; ');
    const bouton = (rep, texte, fond) =>
      `<a href="${lienReponse(base, email, ligne.id, rep)}" style="display:inline-block;background:${fond};color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;font-size:14px;margin:4px 6px 4px 0">${texte}</a>`;
    return `
      <div style="border:1px solid #e8ecf3;border-radius:14px;padding:18px;margin:0 0 16px">
        <div style="font-size:16px;font-weight:800;color:#0a1f3a">${b.name}</div>
        <div style="font-size:13px;color:#888;margin:4px 0 12px">${etape === 2 ? 'Relance envoyée' : 'Demande envoyée'} le ${jour(ligne.sent_at)}</div>
        <div style="font-size:14px;color:#444;line-height:1.7;margin:0 0 12px">
          <strong>1.</strong> Cherchez votre nom ici : ${ou}<br>
          <strong>2.</strong> Dites-nous ce que vous voyez :
        </div>
        ${bouton('ok', 'Je n\'y suis plus', '#16a34a')}${bouton('encore', 'J\'y suis encore', '#d97706')}
      </div>`;
  }).join('');
  const relance = dues.some((d) => d.etape === 1);
  const cnil = dues.some((d) => d.etape === 2);
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
    <div style="background:#010410;padding:24px 32px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="color:#fff;font-size:22px;font-weight:900;width:130px;max-width:50%;height:auto;display:inline-block;border:0">
      <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:10px">Privacy Cleanup — un mois a passé</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="background:#fff;padding:34px 32px">
      <h1 style="margin:0 0 12px;font-size:22px;color:#0a1f3a">${prenom ? `${prenom}, y` : 'Y'} figurez-vous encore&nbsp;?</h1>
      <p style="font-size:15.5px;color:#444;line-height:1.7;margin:0 0 22px">
        Nous avons demandé en votre nom la suppression de vos coordonnées. Les annuaires
        avaient <strong>un mois</strong> pour le faire. Vous seul pouvez voir le résultat :
        deux minutes suffisent.
      </p>
      ${blocs}
      <p style="font-size:13.5px;color:#666;line-height:1.7;margin:0">
        ${relance ? 'Si vous y êtes encore, la relance part aussitôt : vous n\'avez rien d\'autre à faire.<br>' : ''}
        ${cnil ? 'Après une relance sans effet, nous vous envoyons la marche à suivre pour saisir la CNIL.<br>' : ''}
        Vous ne trouvez pas, ou vous hésitez&nbsp;? Répondez simplement à ce message.
      </p>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="padding:24px 32px;text-align:center;background:#010410">
      <p style="font-size:14px;color:rgba(255,255,255,.75);margin:0 0 6px">Une question ? Écrivez-nous — un humain vous répond.</p>
      <p style="font-size:14px;color:#5BE3F5;margin:0;font-weight:600">contact@despy.fr</p>
    </div>
  </div>`;
}

async function envoyer(to, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Despy — Protection des données <contact@despy.fr>',
      to: [to],
      reply_to: 'contact@despy.fr',
      subject: '🕵️ Despy — Un mois a passé : figurez-vous encore dans ces annuaires ?',
      html
    })
  });
  // fetch ne lève pas sur un 4xx : sans ce test, l'email non parti passait
  // pour envoyé, et le client n'était plus jamais interrogé.
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
}

exports.handler = async (event) => {
  if (!isScheduled(event)) return notScheduled();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const base = process.env.URL || 'https://despy.fr';
  const maintenant = new Date();

  const journal = await lire(
    supabase.from('privacy_dispatch_log').select('id, user_email, broker_id, status, sent_at'),
    'privacy_dispatch_log (suivi à un mois)', { alerte: true });
  const demandes = await lire(
    supabase.from('privacy_requests').select('user_email, prenom, status, activated_at'),
    'privacy_requests (suivi à un mois)', { alerte: true });
  if (!journal.ok || !demandes.ok) {
    return { statusCode: 200, body: JSON.stringify({ error: 'lecture' }) };
  }

  // La demande la plus récente de chaque client : c'est elle qui dit s'il a
  // annulé le service, et comment il s'appelle.
  const clients = new Map();
  for (const d of demandes.data || []) {
    const cle = (d.user_email || '').toLowerCase().trim();
    const vue = clients.get(cle);
    if (cle && (!vue || new Date(d.activated_at || 0) > new Date(vue.activated_at || 0))) clients.set(cle, d);
  }

  const parClient = new Map();
  for (const l of journal.data || []) {
    const cle = (l.user_email || '').toLowerCase().trim();
    if (!parClient.has(cle)) parClient.set(cle, []);
    parClient.get(cle).push(l);
  }

  let interroges = 0, erreurs = 0, reportes = 0;

  for (const [email, lignes] of parClient) {
    const d = clients.get(email);
    if (!d || d.status === 'cancelled') continue;

    const dues = [...dernieres(lignes).values()]
      .map((ligne) => ({ ligne, etape: etapeDue(ligne, maintenant) }))
      .filter((x) => x.etape > 0);
    if (!dues.length) continue;

    if (interroges >= MAX_CLIENTS) { reportes++; continue; }

    try {
      await envoyer(email, emailHTML(d.prenom || '', email, dues, base));
    } catch (e) {
      // Le statut ne bouge pas : la question repartira demain.
      erreurs++;
      console.error(`privacy-suivi ${email}: ${e.message}`);
      continue;
    }

    // L'email est parti : on le note. Si cette écriture échoue, le client
    // recevrait la même question demain — d'où l'alerte.
    for (const { ligne, etape } of dues) {
      await ecrire(
        supabase.from('privacy_dispatch_log')
          .update({ status: etape === 2 ? 'asked_again' : 'asked' })
          .eq('id', ligne.id),
        `privacy_dispatch_log.status (question posée) — ${email}`,
        { alerte: true, details: { 'Client': email, 'Conséquence': 'Il recevra la même question demain' } }
      );
    }
    interroges++;
    await new Promise((r) => setTimeout(r, 600));   // Resend : 2 envois par seconde au plus
  }

  const bilan = { interroges, erreurs, reportes };
  console.log('privacy-suivi:', JSON.stringify(bilan));
  if (erreurs > 0) {
    await alerterAdmin(
      `privacy-suivi — ${erreurs} email(s) non partis`,
      'La question « y figurez-vous encore ? » n\'a pas pu être envoyée à tous les clients. '
      + 'Elle repartira demain ; si l\'alerte revient, le problème est côté envoi d\'emails.',
      { 'Clients interrogés': interroges, 'Échecs': erreurs }
    );
  }
  return { statusCode: 200, body: JSON.stringify(bilan) };
};
