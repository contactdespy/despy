// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : envoi AUTOMATIQUE des demandes RGPD art. 17
// POST interne (x-internal-secret) { user_email, prenom, nom, target_email, phone, ville }
//
// Modèle « Incogni » : pas de scan préalable — on envoie la demande
// d'effacement à chaque annuaire de la liste (_privacy-brokers.js), qui est
// légalement tenu de chercher et supprimer (art. 17 + réponse sous 1 mois,
// art. 12.3). Puis :
//   → journal de chaque envoi dans privacy_dispatch_log (suivi RÉEL)
//   → statut de la demande passé à in_progress
//   → email récap au client : ce qui est parti, et les deux démarches que
//     lui seul peut faire (Google, Infobel)
//   → email d'information à l'équipe — plus aucune tâche dedans
//
// On peut l'appeler autant de fois qu'on veut pour le même client : une
// lettre déjà partie à la bonne adresse ne repart pas. C'est ce qui permet au
// passage mensuel de l'appeler pour tout le monde, et à un annuaire ajouté ou
// corrigé d'atteindre les clients existants sans rien faire d'autre.
//
// Les réponses des annuaires arrivent chez le client, avec copie à Despy :
// certains exigent un justificatif d'identité, que lui seul peut fournir.
//
// Mandat : l'activation du service par le client dans son espace (tracée
// en base avec la date) vaut mandat pour agir en son nom.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { EMAIL_BROKERS, GUIDES_CLIENT } = require('./_privacy-brokers');
const { ecrire, lire } = require('./_db');

// Envoi direct Resend — lettre légale : pas d'en-tête de désinscription.
async function sendRaw(to, subject, html, replyTo) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Despy — Protection des données <contact@despy.fr>',
      to: [to],
      reply_to: replyTo || 'contact@despy.fr',   // une adresse, ou un tableau
      subject,
      html
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// La demande d'effacement elle-même (texte sobre, juridique, sans fioritures)
function buildArt17HTML(c, broker) {
  const fullName = `${c.prenom} ${c.nom}`.trim();
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111;font-size:15px;line-height:1.7">
    <p>Madame, Monsieur,</p>
    <p>
      Agissant au nom et pour le compte de <strong>${fullName}</strong>, demeurant à ${c.ville},
      qui a mandaté notre service de protection numérique Despy à cette fin le
      ${new Date(c.activated_at || Date.now()).toLocaleDateString('fr-FR')} (mandat disponible sur demande),
      nous vous demandons l'<strong>effacement complet des données personnelles</strong> la/le concernant
      présentes sur vos services et dans vos bases de données, conformément à
      l'<strong>article 17 du Règlement (UE) 2016/679 (RGPD)</strong>.
    </p>
    ${broker.platformNote ? `<p><em>${broker.platformNote}</em></p>` : ''}
    <p><strong>Données concernées :</strong></p>
    <ul>
      <li>Nom et prénom : ${fullName}</li>
      <li>Adresse email : ${c.target_email}</li>
      <li>Numéro de téléphone : ${c.phone}</li>
      <li>Toute fiche, page ou entrée d'annuaire à ce nom</li>
    </ul>
    <p>Nous vous rappelons que :</p>
    <ol>
      <li>l'article 17 du RGPD impose l'effacement dans les meilleurs délais lorsque la personne concernée s'oppose au traitement ;</li>
      <li>l'article 12.3 impose une réponse dans un délai d'un mois ;</li>
      <li>à défaut, une plainte sera déposée auprès de la CNIL.</li>
    </ol>
    <p>Merci de confirmer par retour d'email l'effacement effectif des données.
      Votre réponse parviendra à ${fullName} et à notre service ; si vous avez
      besoin d'un justificatif d'identité, c'est ${fullName} qui vous le transmettra.</p>
    <p>
      Cordialement,<br>
      <strong>Despy</strong> — service de protection numérique, pour ${fullName}<br>
      contact@despy.fr · despy.fr · SIRET 103 694 212 00012
    </p>
  </div>`;
}

// Récap premium envoyé au client
function buildClientRecapHTML(c, sentBrokers, renvoi) {
  const sentList = sentBrokers.map(b => `
    <div style="padding:12px 16px;border-bottom:1px solid #f1f3f7;font-size:14.5px;color:#0a1f3a">
      ✅ <strong>${b.name}</strong> <span style="color:#888;font-size:12.5px">— demande légale envoyée</span>
    </div>`).join('');
  // Les démarches que l'annuaire n'accepte que de la personne elle-même.
  const guides = GUIDES_CLIENT.map(g => `
    <div style="padding:12px 16px;border-top:1px solid #f0e6d6;font-size:13.5px;color:#555;line-height:1.7">
      <a href="${g.url}" style="color:#1a3fd9;font-weight:700">${g.name}</a><br>
      ${g.comment}<br>
      <span style="color:#888;font-size:12.5px">${g.pourquoi}</span>
    </div>`).join('');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
    <div style="background:#010410;padding:24px 32px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="color:#fff;font-size:22px;font-weight:900;width:130px;max-width:50%;height:auto;display:inline-block;border:0">
      <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:10px">Privacy Cleanup — c'est parti</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="background:#fff;padding:34px 32px">
      <h1 style="margin:0 0 12px;font-size:23px;color:#0a1f3a">C'est fait, ${c.prenom} 🕵️</h1>
      <p style="font-size:15.5px;color:#444;line-height:1.7;margin:0 0 20px">
        Nous venons d'envoyer <strong>en votre nom</strong> les demandes légales d'effacement
        de vos données personnelles (article 17 du RGPD). Les annuaires contactés ont
        <strong>un mois maximum</strong> pour supprimer vos informations.
      </p>
      ${renvoi ? `<p style="font-size:13.5px;color:#666;line-height:1.7;margin:0 0 20px">
        Certaines de ces demandes vous avaient déjà été annoncées. Nous les renvoyons
        aujourd'hui à l'adresse que chaque annuaire désigne pour ce type de demande,
        et la demande faite à Solocal nomme désormais aussi 118&nbsp;712.
      </p>` : ''}
      <div style="border:1px solid #e8ecf3;border-radius:14px;overflow:hidden;margin:0 0 20px">
        <div style="background:#0a1f3a;padding:11px 16px;font-size:12px;color:#5BE3F5;text-transform:uppercase;letter-spacing:.1em;font-weight:700">Demandes envoyées aujourd'hui</div>
        ${sentList}
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 18px;margin:0 0 20px">
        <div style="font-size:14px;color:#1a3fd9;font-weight:700;margin-bottom:6px">Si un annuaire vous répond</div>
        <div style="font-size:13.5px;color:#444;line-height:1.7">
          Sa réponse vous arrive directement, avec copie à Despy. Certains demandent
          une copie de pièce d'identité avant de supprimer : c'est normal, et vous
          seul pouvez la leur envoyer. Un doute sur un message&nbsp;? Transférez-le-nous
          avant de répondre.
        </div>
      </div>
      <div style="border:1px solid #f0e6d6;border-radius:14px;overflow:hidden;margin:0 0 20px">
        <div style="background:#fff7ed;padding:12px 16px;font-size:14px;color:#b45309;font-weight:700">Deux démarches que vous seul pouvez faire</div>
        ${guides}
      </div>
      <p style="font-size:13.5px;color:#666;line-height:1.7;margin:0 0 20px">
        <strong>Dans un mois</strong>, nous vous demanderons si vous figurez encore dans ces
        annuaires : si oui, un clic suffira pour relancer. Vous suivez l'avancement dans
        votre espace Despy, et nous revérifions chaque mois que vos données ne
        réapparaissent pas.
      </p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 18px;margin:0 0 24px">
        <div style="font-size:14px;color:#d97706;font-weight:700;margin-bottom:6px">💡 Le petit geste qui complète tout</div>
        <div style="font-size:13.5px;color:#555;line-height:1.7">
          Demandez à votre opérateur téléphonique l'inscription en <strong>« liste rouge »</strong>
          (gratuit, depuis votre espace client opérateur) : votre numéro ne sera plus
          transmis aux annuaires. C'est la source de la plupart des republications.
        </div>
      </div>
      <div style="text-align:center;margin:0 0 8px">
        <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:15px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">Suivre l'avancement dans mon espace</a>
      </div>
      <p style="font-size:13px;color:#999;line-height:1.6;text-align:center;margin:22px 0 0">🔒 Vos données sont hébergées en France 🇫🇷, chiffrées et jamais revendues.</p>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="padding:24px 32px;text-align:center;background:#010410">
      <p style="font-size:14px;color:rgba(255,255,255,.75);margin:0 0 6px">Une question ? Écrivez-nous — un humain vous répond.</p>
      <p style="font-size:14px;color:#5BE3F5;margin:0;font-weight:600">contact@despy.fr</p>
    </div>
  </div>`;
}

// Information interne : ce qui est parti. Il ne porte PLUS aucune tâche — c'est
// parce qu'il en portait, et qu'il n'arrivait pas, que quatre destinataires sur
// sept n'ont été contactés pour personne. S'il se perd, rien n'est perdu.
function buildAdminRecapHTML(c, sent, failed) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;font-size:14px;color:#333;line-height:1.7">
    <h2 style="color:#0a1f3a">🕵️ Privacy Cleanup — ${c.prenom} ${c.nom} (${c.user_email})</h2>
    <p><strong>${sent.length} demande(s) RGPD envoyée(s) automatiquement</strong> :
    ${sent.map(b => `${b.name} (${b.email})`).join(' · ') || 'aucune'}${failed.length ? `<br>⚠️ Échec d'envoi : ${failed.map(b => b.name).join(' · ')} — elles repartiront au prochain passage mensuel` : ''}</p>
    <p>Rien à faire. Le client a reçu le chemin pour ${GUIDES_CLIENT.map(g => g.name).join(' et ')},
    qu'il est seul à pouvoir saisir. Les réponses des annuaires lui arrivent directement,
    avec copie dans contact@despy.fr.</p>
    <p style="color:#888;font-size:12px">Statut Supabase : passé à in_progress automatiquement · journal dans privacy_dispatch_log</p>
  </div>`;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  const secret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
  if (!process.env.INTERNAL_SECRET || secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  let c = {};
  try { c = JSON.parse(event.body || '{}'); } catch (e) {}
  const required = ['user_email', 'prenom', 'nom', 'target_email', 'phone', 'ville'];
  if (required.some(k => !c[k])) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing_fields' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const email = c.user_email.toLowerCase().trim();
  const sent = [];
  const failed = [];

  // 0. Qu'est-ce qui est déjà parti, et à la bonne adresse ?
  // Si on ne peut pas le savoir, on n'envoie rien : une lettre juridique en
  // double chez un annuaire coûte plus cher qu'une lettre qui part au passage
  // suivant. L'appelant reçoit une erreur et sait que rien n'est parti.
  const journal = await lire(
    supabase.from('privacy_dispatch_log').select('broker_id, sent_at').eq('user_email', email),
    `privacy_dispatch_log (déjà envoyé ?) — ${email}`,
    { alerte: true, details: {
        'Client': email,
        'Conséquence': 'Aucune demande art. 17 envoyée cette fois — reprise au prochain passage mensuel'
      } }
  );
  if (!journal.ok) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'journal_illisible' }) };
  }
  const lignes = journal.data || [];

  // Une lettre compte si elle est partie depuis que l'adresse (ou le contenu)
  // de cet annuaire est le bon — voir `depuis` dans _privacy-brokers.js.
  const dejaParti = (broker) => lignes.some(l =>
    l.broker_id === broker.id &&
    (!broker.depuis || new Date(l.sent_at) >= new Date(broker.depuis)));

  // `force` : le client vient de corriger ses informations (privacy-request).
  // Les annuaires ont reçu l'ancien numéro ou l'ancien nom : tout repart.
  const aEnvoyer = c.force ? EMAIL_BROKERS : EMAIL_BROKERS.filter(b => !dejaParti(b));
  if (aEnvoyer.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, failed: 0, deja: EMAIL_BROKERS.length }) };
  }
  // Des lettres étaient déjà parties pour ce client : le récap le lui dit,
  // pour qu'il ne croie pas à une erreur en recevant une seconde annonce.
  const renvoi = lignes.length > 0 && !c.force;

  // 1. Envoi de la demande art. 17 à chaque annuaire restant
  for (const broker of aEnvoyer) {
    try {
      await sendRaw(
        broker.email,
        `Demande d'effacement de données personnelles — Article 17 RGPD (${c.prenom} ${c.nom})`,
        buildArt17HTML(c, broker),
        [email, 'contact@despy.fr']
      );
      sent.push(broker);

      // Ce journal N'EST PAS accessoire : c'est la seule trace qu'une demande
      // est partie. L'espace client en tire ses compteurs, et le cron mensuel
      // s'en sert pour savoir qui n'a jamais été traité. S'il n'est pas écrit,
      // le courrier est bien parti mais Despy l'a oublié — et rejouera un
      // rattrapage au prochain passage, cette fois en doublon chez le broker.
      await ecrire(
        supabase.from('privacy_dispatch_log').insert({
          user_email: email,
          broker_id: broker.id,
          broker_name: broker.name,
          status: 'sent'
        }),
        `privacy_dispatch_log — ${broker.id} pour ${c.user_email}`,
        { alerte: true, details: {
            'Client': c.user_email,
            'Broker': `${broker.name} (${broker.id})`,
            'Conséquence': 'Demande art. 17 envoyée mais non journalisée — à saisir à la main'
          } }
      );
      await new Promise(r => setTimeout(r, 600));   // Resend : 2 envois par seconde au plus
    } catch (e) {
      console.error(`Envoi ${broker.id} échoué:`, e.message);
      failed.push(broker);
    }
  }

  // 2. Statut de la demande → in_progress
  // Pas d'alerte email ici : le journal ci-dessus porte déjà l'information qui
  // compte, et ce statut se rattrape tout seul au passage suivant. Une alerte
  // de plus pour la même panne ferait du bruit, pas du signal.
  await ecrire(
    supabase.from('privacy_requests')
      .update({
        status: 'in_progress',
        notes: `Dispatch auto le ${new Date().toISOString().slice(0, 10)} — envoyé : ${sent.map(b => b.id).join(', ') || 'aucun'}${failed.length ? ' · échecs : ' + failed.map(b => b.id).join(', ') : ''}`
      })
      .eq('user_email', email),
    `privacy_requests.status — ${c.user_email}`
  );

  // 3. Récap au client (uniquement si au moins un envoi a réussi)
  if (sent.length > 0) {
    try {
      await sendRaw(
        c.user_email,
        `🕵️ Despy — ${sent.length} demande${sent.length > 1 ? 's' : ''} de suppression envoyée${sent.length > 1 ? 's' : ''} en votre nom`,
        buildClientRecapHTML(c, sent, renvoi)
      );
    } catch (e) { console.error('récap client:', e.message); }
  }

  // 4. Information à l'équipe — rien à y faire, voir buildAdminRecapHTML
  try {
    await sendRaw(
      'contact.despy@gmail.com',
      `🕵️ Privacy Cleanup ${c.prenom} ${c.nom} : ${sent.length} lettre(s) envoyée(s)${failed.length ? `, ${failed.length} en échec` : ''}`,
      buildAdminRecapHTML(c, sent, failed)
    );
  } catch (e) { console.error('récap admin:', e.message); }

  console.log(`Privacy dispatch ${c.user_email}: ${sent.length} envoyés, ${failed.length} échecs`);
  return { statusCode: 200, headers, body: JSON.stringify({ sent: sent.length, failed: failed.length, deja: EMAIL_BROKERS.length - aEnvoyer.length }) };
};
