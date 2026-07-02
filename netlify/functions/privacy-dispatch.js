// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : envoi AUTOMATIQUE des demandes RGPD art. 17
// POST interne (x-internal-secret) { user_email, prenom, nom, target_email, phone, ville }
//
// Modèle « Incogni » : pas de scan préalable — on envoie la demande
// d'effacement à chaque broker de la liste (_privacy-brokers.js), qui est
// légalement tenu de chercher et supprimer (art. 17 + réponse sous 1 mois,
// art. 12.3). Puis :
//   → journal de chaque envoi dans privacy_dispatch_log (suivi RÉEL)
//   → statut de la demande passé à in_progress
//   → email récap premium au client (« vos demandes sont parties »)
//   → email récap à l'équipe avec les formulaires restant à traiter (~5 min)
//
// Mandat : l'activation du service par le client dans son espace (tracée
// en base avec la date) vaut mandat pour agir en son nom.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { EMAIL_BROKERS, FORM_BROKERS } = require('./_privacy-brokers');

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
      reply_to: replyTo || 'contact@despy.fr',
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
    <p>Merci de confirmer par retour d'email l'effacement effectif des données.</p>
    <p>
      Cordialement,<br>
      <strong>Despy</strong> — service de protection numérique, pour ${fullName}<br>
      contact@despy.fr · despy.fr · SIRET 103 694 212 00012
    </p>
  </div>`;
}

// Récap premium envoyé au client
function buildClientRecapHTML(c, sentBrokers) {
  const sentList = sentBrokers.map(b => `
    <div style="padding:12px 16px;border-bottom:1px solid #f1f3f7;font-size:14.5px;color:#0a1f3a">
      ✅ <strong>${b.name}</strong> <span style="color:#888;font-size:12.5px">— demande légale envoyée</span>
    </div>`).join('');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
    <div style="background:#010410;padding:24px 32px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="width:130px;max-width:50%;height:auto;display:inline-block;border:0">
      <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:10px">Privacy Cleanup — c'est parti</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="background:#fff;padding:34px 32px">
      <h1 style="margin:0 0 12px;font-size:23px;color:#0a1f3a">C'est fait, ${c.prenom} 🕵️</h1>
      <p style="font-size:15.5px;color:#444;line-height:1.7;margin:0 0 20px">
        Nous venons d'envoyer <strong>en votre nom</strong> les demandes légales d'effacement
        de vos données personnelles (article 17 du RGPD). Les sites contactés ont
        <strong>un mois maximum</strong> pour supprimer vos informations — la plupart le font
        en quelques jours.
      </p>
      <div style="border:1px solid #e8ecf3;border-radius:14px;overflow:hidden;margin:0 0 20px">
        <div style="background:#0a1f3a;padding:11px 16px;font-size:12px;color:#5BE3F5;text-transform:uppercase;letter-spacing:.1em;font-weight:700">Demandes envoyées aujourd'hui</div>
        ${sentList}
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 18px;margin:0 0 20px">
        <div style="font-size:14px;color:#1a3fd9;font-weight:700;margin-bottom:6px">Et ce n'est pas tout</div>
        <div style="font-size:13.5px;color:#444;line-height:1.7">
          Notre équipe traite aussi les annuaires qui exigent un formulaire
          (118712, Infobel…) et surveille les réponses. Vous suivez l'avancement
          dans votre espace Despy, et nous revérifions chaque mois que vos données
          ne réapparaissent pas.
        </div>
      </div>
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

// Récap interne pour l'équipe : ce qui est parti + ce qui reste (formulaires)
function buildAdminRecapHTML(c, sent, failed) {
  const forms = FORM_BROKERS.map(b => `<li><a href="${b.url}">${b.name}</a> — ${b.note}</li>`).join('');
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;font-size:14px;color:#333;line-height:1.7">
    <h2 style="color:#0a1f3a">🕵️ Privacy Cleanup — ${c.prenom} ${c.nom} (${c.user_email})</h2>
    <p><strong>${sent.length} demande(s) RGPD envoyée(s) automatiquement</strong> :
    ${sent.map(b => b.name).join(' · ') || 'aucune'}${failed.length ? `<br>⚠️ Échec d'envoi : ${failed.map(b => b.name).join(' · ')} (voir logs Resend)` : ''}</p>
    <p><strong>Reste à faire à la main (~5 min)</strong> — formulaires avec ses infos
    (${c.prenom} ${c.nom}, ${c.target_email}, ${c.phone}, ${c.ville}) :</p>
    <ul>${forms}</ul>
    <p>Ensuite : surveiller les réponses des brokers dans la boîte contact@despy.fr
    (certains demandent un justificatif). Relance à 30 jours si silence.</p>
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
  const sent = [];
  const failed = [];

  // 1. Envoi de la demande art. 17 à chaque broker « email »
  for (const broker of EMAIL_BROKERS) {
    try {
      await sendRaw(
        broker.email,
        `Demande d'effacement de données personnelles — Article 17 RGPD (${c.prenom} ${c.nom})`,
        buildArt17HTML(c, broker)
      );
      sent.push(broker);
      // journal best-effort (la table peut ne pas exister encore)
      try {
        await supabase.from('privacy_dispatch_log').insert({
          user_email: c.user_email.toLowerCase().trim(),
          broker_id: broker.id,
          broker_name: broker.name,
          status: 'sent'
        });
      } catch (e) { console.warn('log insert:', e.message); }
      await new Promise(r => setTimeout(r, 700));
    } catch (e) {
      console.error(`Envoi ${broker.id} échoué:`, e.message);
      failed.push(broker);
    }
  }

  // 2. Statut de la demande → in_progress (best-effort)
  try {
    await supabase.from('privacy_requests')
      .update({
        status: 'in_progress',
        notes: `Dispatch auto le ${new Date().toISOString().slice(0, 10)} — envoyé : ${sent.map(b => b.id).join(', ') || 'aucun'}${failed.length ? ' · échecs : ' + failed.map(b => b.id).join(', ') : ''}`
      })
      .eq('user_email', c.user_email.toLowerCase().trim());
  } catch (e) { console.warn('update status:', e.message); }

  // 3. Récap au client (uniquement si au moins un envoi a réussi)
  if (sent.length > 0) {
    try {
      await sendRaw(
        c.user_email,
        `🕵️ Despy — ${sent.length} demande${sent.length > 1 ? 's' : ''} de suppression envoyée${sent.length > 1 ? 's' : ''} en votre nom`,
        buildClientRecapHTML(c, sent)
      );
    } catch (e) { console.error('récap client:', e.message); }
  }

  // 4. Récap à l'équipe (toujours — il contient la liste des formulaires à faire)
  try {
    await sendRaw(
      'contact.despy@gmail.com',
      `🕵️ Privacy Cleanup ${c.prenom} ${c.nom} : ${sent.length} auto + ${FORM_BROKERS.length} formulaires à faire`,
      buildAdminRecapHTML(c, sent, failed)
    );
  } catch (e) { console.error('récap admin:', e.message); }

  console.log(`Privacy dispatch ${c.user_email}: ${sent.length} envoyés, ${failed.length} échecs`);
  return { statusCode: 200, headers, body: JSON.stringify({ sent: sent.length, failed: failed.length, manual: FORM_BROKERS.length }) };
};
