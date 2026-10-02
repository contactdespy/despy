// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : la réponse du client, un mois après la lettre
// GET  ?e=<email>&l=<id de ligne>&r=<ok|encore>&k=<signature>  → page de confirmation
// POST (mêmes paramètres)                                       → l'action
//
//   r=ok      → la demande passe à « supprimé » dans son espace.
//   r=encore  → après la première lettre : la relance part chez l'annuaire.
//               après la relance : on lui envoie la marche à suivre pour la CNIL.
//
// Le lien de l'email ne FAIT rien : il ouvre une page, et c'est le bouton de
// cette page qui agit. Des messageries ouvrent d'elles-mêmes les liens d'un
// email pour les analyser ; une lettre juridique ne doit pas partir, ni une
// demande être close, parce qu'un antivirus a suivi un lien.
//
// Page chaleureuse et sans jargon : c'est souvent un senior qui la lit.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');
const { ecrire, lire, alerterAdmin } = require('./_db');
const { annuaire, dernieres } = require('./_privacy-suivi');

const jour = (d) => new Date(d).toLocaleDateString('fr-FR');

function page(emoji, titre, message, bouton) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${titre} — Despy</title></head>
<body style="margin:0;background:#f7f9fc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:50px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.08)">
    <div style="background:#010410;padding:24px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="color:#fff;font-size:22px;font-weight:900;width:130px;height:auto;border:0">
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF)"></div>
    <div style="padding:38px 32px;text-align:center">
      <div style="font-size:52px;margin-bottom:14px">${emoji}</div>
      <div style="font-size:21px;font-weight:800;color:#0a1f3a;margin-bottom:12px">${titre}</div>
      <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 22px">${message}</p>
      ${bouton || '<a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;text-decoration:none;padding:13px 30px;border-radius:10px;font-weight:700;font-size:15px">Retour à mon espace</a>'}
    </div>
    <div style="padding:16px;text-align:center;font-size:12px;color:#aaa;background:#fafbfc">Une question ? contact@despy.fr · un humain vous répond</div>
  </div>
</body></html>`;
}

async function envoyer(message) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ from: 'Despy — Protection des données <contact@despy.fr>' }, message))
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
}

// La relance : sobre, datée, et qui dit ce qui a été constaté.
function relanceHTML(c, b, premiere) {
  const nom = `${c.prenom} ${c.nom}`.trim();
  return `
  <div style="font-family:Georgia,serif;font-size:15px;color:#222;line-height:1.7;max-width:640px">
    <p>Madame, Monsieur,</p>
    <p>
      Le ${jour(premiere.sent_at)}, nous vous avons adressé, au nom et pour le compte de
      <strong>${nom}</strong>, demeurant à ${c.ville}, une demande d'effacement de ses données
      personnelles au titre de l'article 17 du Règlement (UE) 2016/679 (RGPD).
    </p>
    <p>
      Le délai d'un mois fixé par l'article 12.3 est écoulé, et ${nom} constate que ses
      coordonnées sont toujours publiées.
    </p>
    ${b.platformNote ? `<p><strong>${b.platformNote}</strong></p>` : ''}
    <p>Données concernées :</p>
    <ul>
      <li>Nom et prénom : ${nom}</li>
      <li>Adresse email : ${c.target_email}</li>
      <li>Numéro de téléphone : ${c.phone}</li>
      <li>Toute fiche, page ou entrée d'annuaire à ce nom</li>
    </ul>
    <p>
      Nous vous demandons de procéder à cet effacement sans délai et de nous le confirmer
      par retour d'email. À défaut, ${nom} saisira la CNIL en produisant la présente
      relance et la demande initiale.
    </p>
    <p>
      Votre réponse parviendra à ${nom} et à notre service ; si vous avez besoin d'un
      justificatif d'identité, c'est ${nom} qui vous le transmettra.
    </p>
    <p>
      Cordialement,<br>
      <strong>Despy</strong> — service de protection numérique, pour ${nom}<br>
      contact@despy.fr · despy.fr · SIRET 103 694 212 00012
    </p>
  </div>`;
}

// Après deux lettres sans effet : ce que le client peut faire, et avec quoi.
function cnilHTML(prenom, b, lettres) {
  const dates = lettres.map((l, i) => `<li>${i === 0 ? 'Demande d\'effacement' : 'Relance'} envoyée le <strong>${jour(l.sent_at)}</strong> à ${b.email}</li>`).join('');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;font-size:15px;color:#333;line-height:1.7">
    <h2 style="color:#0a1f3a">${prenom ? `${prenom}, v` : 'V'}ous pouvez saisir la CNIL</h2>
    <p>
      ${b.name} n'a pas retiré vos coordonnées malgré deux demandes. Écrire une troisième
      fois ne servirait à rien : la suite est une plainte auprès de la CNIL. Elle est
      gratuite, elle se fait en ligne, et elle doit être <strong>à votre nom</strong> —
      c'est votre droit, personne ne peut la déposer à votre place.
    </p>
    <p><strong>Ce qu'il vous faut, et vous l'avez :</strong></p>
    <ul>${dates}</ul>
    <p>
      Les deux lettres vous ont été adressées en copie : gardez-les, la CNIL les demandera.
    </p>
    <p style="text-align:center;margin:26px 0">
      <a href="https://www.cnil.fr/fr/plaintes" style="display:inline-block;background:#2D5BFF;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700">Déposer une plainte sur cnil.fr</a>
    </p>
    <p>
      Vous préférez qu'on le fasse ensemble&nbsp;? Répondez à ce message : on prépare le
      dossier avec vous.
    </p>
    <p style="color:#888;font-size:13px">Despy · contact@despy.fr</p>
  </div>`;
}

exports.handler = async (event) => {
  const html = (code, corps) => ({ statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: corps });
  const q = event.queryStringParameters || {};
  const email = (q.e || '').toLowerCase().trim();
  const ligneId = String(q.l || '');
  const rep = q.r;

  if (!email || !ligneId || !['ok', 'encore'].includes(rep) || !q.k) {
    return html(400, page('⚠️', 'Lien incomplet', 'Ce lien est incomplet. Rouvrez l\'email que nous vous avons envoyé et cliquez à nouveau.'));
  }
  if (q.k !== signFinding(email, ligneId, 'suivi')) {
    return html(403, page('🔒', 'Lien invalide', 'Ce lien n\'est pas valide. Rouvrez l\'email d\'origine et cliquez sur le bouton directement.'));
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const journal = await lire(
    supabase.from('privacy_dispatch_log')
      .select('id, broker_id, broker_name, status, sent_at')
      .eq('user_email', email),
    `privacy_dispatch_log (réponse du client) — ${email}`);
  if (!journal.ok) {
    return html(503, page('😕', 'Un souci de notre côté', 'Nous n\'avons pas pu lire votre dossier à l\'instant. Rien n\'a été modifié : réessayez dans quelques minutes avec le même lien.'));
  }

  const lignes = journal.data || [];
  const ligne = lignes.find((l) => String(l.id) === ligneId);
  const b = ligne && annuaire(ligne.broker_id);
  if (!ligne || !b) {
    return html(404, page('🤔', 'Demande introuvable', 'Nous ne retrouvons pas cette demande. Écrivez-nous à contact@despy.fr, nous regardons avec vous.'));
  }

  // Seule la ligne la plus récente de l'annuaire compte. Si une relance est
  // partie depuis, ce lien appartient à une étape déjà passée — c'est ce qui
  // empêche un second clic d'envoyer une seconde relance.
  const courante = dernieres(lignes).get(ligne.broker_id);
  if (String(courante.id) !== ligneId) {
    return html(200, page('✅', 'C\'est déjà pris en compte', `Votre réponse pour ${b.name} a bien été enregistrée : la relance est partie le ${jour(courante.sent_at)}.`));
  }
  if (ligne.status === 'confirmed') {
    return html(200, page('✅', 'C\'est déjà noté', `Vous nous avez déjà indiqué que vous ne figuriez plus dans ${b.name}.`));
  }
  if (ligne.status === 'cnil') {
    return html(200, page('✅', 'C\'est déjà pris en compte', `Nous vous avons envoyé la marche à suivre pour saisir la CNIL au sujet de ${b.name}.`));
  }
  const etape = (ligne.status === 'reminded' || ligne.status === 'asked_again') ? 2 : 1;

  // ── GET : on demande confirmation, on ne touche à rien ──
  if (event.httpMethod !== 'POST') {
    const ici = `/.netlify/functions/privacy-suivi-reponse?e=${encodeURIComponent(email)}&l=${ligneId}&k=${q.k}`;
    const quoi = rep === 'ok'
      ? `Vous confirmez que vous ne figurez plus dans <strong>${b.name}</strong>&nbsp;?`
      : etape === 1
        ? `Vous figurez encore dans <strong>${b.name}</strong>&nbsp;? Nous envoyons tout de suite une relance en votre nom.`
        : `Vous figurez encore dans <strong>${b.name}</strong> malgré la relance&nbsp;? Nous vous envoyons la marche à suivre pour saisir la CNIL.`;
    const bouton = `
      <form method="POST" action="${ici}&r=${rep}" style="margin:0 0 14px">
        <button type="submit" style="background:${rep === 'ok' ? '#16a34a' : '#d97706'};color:#fff;border:0;padding:15px 30px;border-radius:12px;font-weight:700;font-size:16px;cursor:pointer;font-family:inherit">
          ${rep === 'ok' ? 'Oui, je n\'y suis plus' : 'Oui, j\'y suis encore'}
        </button>
      </form>
      <a href="${ici}&r=${rep === 'ok' ? 'encore' : 'ok'}" style="font-size:13.5px;color:#888">Je me suis trompé de bouton</a>`;
    return html(200, page(rep === 'ok' ? '🔎' : '✉️', 'Une dernière confirmation', quoi, bouton));
  }

  // ── POST : « je n'y suis plus » ──
  if (rep === 'ok') {
    const w = await ecrire(
      supabase.from('privacy_dispatch_log').update({ status: 'confirmed' }).eq('id', ligne.id),
      `privacy_dispatch_log.status (retrait confirmé) — ${email}`, { alerte: true, details: { 'Client': email, 'Annuaire': b.name } });
    if (!w.ok) {
      return html(500, page('😕', 'Ça n\'a pas fonctionné', 'Votre réponse n\'a pas pu être enregistrée à l\'instant. Réessayez dans quelques minutes avec le même lien.'));
    }
    return html(200, page('🎉', 'Bonne nouvelle, c\'est noté', `Vous ne figurez plus dans ${b.name}. Votre espace Despy est à jour.`));
  }

  // ── POST : « j'y suis encore », après la relance → la CNIL ──
  if (etape === 2) {
    const deLAnnuaire = lignes.filter((l) => l.broker_id === ligne.broker_id)
      .sort((x, y) => new Date(x.sent_at) - new Date(y.sent_at));
    const lettres = [deLAnnuaire.find((l) => l.status !== 'reminded' && l.status !== 'asked_again') || deLAnnuaire[0], ligne];
    const cli = await lire(
      supabase.from('privacy_requests').select('prenom, activated_at').eq('user_email', email)
        .order('activated_at', { ascending: false }).limit(1),
      `privacy_requests (prénom) — ${email}`);
    const prenom = (cli.ok && cli.data && cli.data[0] && cli.data[0].prenom) || '';
    try {
      await envoyer({
        to: [email], bcc: ['contact.despy@gmail.com'], reply_to: 'contact@despy.fr',
        subject: `🕵️ Despy — ${b.name} : la marche à suivre pour saisir la CNIL`,
        html: cnilHTML(prenom, b, lettres)
      });
    } catch (e) {
      console.error(`privacy-suivi-reponse ${email}: guide CNIL non parti: ${e.message}`);
      return html(502, page('😕', 'Ça n\'a pas fonctionné', 'Nous n\'avons pas pu vous envoyer la marche à suivre à l\'instant. Réessayez dans quelques minutes avec le même lien.'));
    }
    await ecrire(
      supabase.from('privacy_dispatch_log').update({ status: 'cnil' }).eq('id', ligne.id),
      `privacy_dispatch_log.status (CNIL) — ${email}`, { alerte: true, details: { 'Client': email, 'Annuaire': b.name } });
    return html(200, page('📨', 'Regardez votre boîte mail', `Deux demandes sans effet : la suite est une plainte auprès de la CNIL, à votre nom. Nous venons de vous envoyer la marche à suivre, avec les dates de vos deux demandes.`));
  }

  // ── POST : « j'y suis encore », après la première lettre → la relance ──
  const cli = await lire(
    supabase.from('privacy_requests')
      .select('prenom, nom, target_email, phone, ville, activated_at').eq('user_email', email)
      .order('activated_at', { ascending: false }).limit(1),
    `privacy_requests (identité pour la relance) — ${email}`);
  const c = cli.ok && cli.data && cli.data[0];
  if (!c || ['prenom', 'nom', 'target_email', 'phone', 'ville'].some((k) => !c[k])) {
    // On ne devine pas l'identité de quelqu'un pour envoyer une lettre en son nom.
    await alerterAdmin(`privacy-suivi-reponse — relance impossible pour ${email}`,
      'Le client dit figurer encore dans un annuaire, mais son dossier est incomplet : la relance n\'est pas partie.',
      { 'Client': email, 'Annuaire': b.name });
    return html(200, page('✍️', 'On s\'en occupe avec vous', 'Il nous manque une information pour relancer en votre nom. Nous sommes prévenus et nous revenons vers vous très vite.'));
  }

  try {
    await envoyer({
      to: [b.email], reply_to: [email, 'contact@despy.fr'],
      subject: `RELANCE — Demande d'effacement de données personnelles — Article 17 RGPD (${c.prenom} ${c.nom})`,
      html: relanceHTML(c, b, ligne)
    });
  } catch (e) {
    console.error(`privacy-suivi-reponse ${email}: relance non partie: ${e.message}`);
    return html(502, page('😕', 'Ça n\'a pas fonctionné', 'La relance n\'a pas pu partir à l\'instant. Réessayez dans quelques minutes avec le même lien : rien n\'a été envoyé en double.'));
  }

  // La relance est partie : la nouvelle ligne est ce qui empêche un second
  // clic d'en envoyer une autre. Si elle n'est pas écrite, il faut le savoir.
  await ecrire(
    supabase.from('privacy_dispatch_log').insert({
      user_email: email, broker_id: b.id, broker_name: b.name, status: 'reminded'
    }),
    `privacy_dispatch_log (relance) — ${b.id} pour ${email}`,
    { alerte: true, details: { 'Client': email, 'Annuaire': b.name,
        'Conséquence': 'Relance envoyée mais non journalisée — un second clic en enverrait une autre' } });

  return html(200, page('✉️', 'La relance est partie', `Nous venons de relancer ${b.name} en votre nom. Sa réponse vous arrivera directement. Nous vous reposerons la question dans un mois.`));
};
