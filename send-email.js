// ════════════════════════════════════════════
// DESPY — Service Email via Resend
// Types : welcome, cancelled, payment_failed
// ════════════════════════════════════════════

const sendResend = async (to, subject, html) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Despy <contact.despy@gmail.com>',
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
  return res.json();
};

const templates = {

  // ── Email de bienvenue ──
  welcome: ({ name, email, plan }) => ({
    subject: '🛡️ Bienvenue dans Despy — Votre protection est active',
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="text-align:center;margin-bottom:32px">
          <div style="width:56px;height:56px;border-radius:14px;background:#2D5BFF;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px">
            <span style="font-size:28px">🛡️</span>
          </div>
          <h1 style="font-size:22px;font-weight:900;color:#111;margin:0">Bienvenue dans Despy !</h1>
        </div>
        <p style="font-size:15px;color:#555;line-height:1.7">Bonjour <strong>${name}</strong>,</p>
        <p style="font-size:15px;color:#555;line-height:1.7">
          Votre abonnement <strong>Despy ${plan === 'annual' ? 'Annuel' : 'Mensuel'}</strong> est maintenant actif. 
          Vous pouvez accéder à votre espace de protection dès maintenant.
        </p>
        <div style="background:#f5f7ff;border-radius:12px;padding:20px;margin:24px 0">
          <p style="font-size:14px;font-weight:700;color:#111;margin:0 0 12px">Ce que vous pouvez faire maintenant :</p>
          <p style="font-size:14px;color:#555;margin:0">✅ Lancer votre audit de sécurité<br>✅ Poser vos questions au Conseiller Despy<br>✅ Vérifier si vos données ont été compromises<br>✅ Analyser un SMS ou email suspect</p>
        </div>
        <div style="text-align:center;margin:28px 0">
          <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
            Accéder à mon espace →
          </a>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999;text-align:center">
          Despy — Protection numérique pour particuliers<br>
          Une question ? <a href="mailto:contact.despy@gmail.com" style="color:#2D5BFF">contact.despy@gmail.com</a><br>
          Résiliation : <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a> → Espace client → Paramètres
        </p>
      </div>
    `
  }),

  // ── Email annulation ──
  cancelled: ({ name, email }) => ({
    subject: 'Votre abonnement Despy a été résilié',
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
        <h1 style="font-size:20px;font-weight:900;color:#111">Votre abonnement Despy est résilié</h1>
        <p style="font-size:15px;color:#555;line-height:1.7">Bonjour <strong>${name}</strong>,</p>
        <p style="font-size:15px;color:#555;line-height:1.7">
          Votre abonnement Despy a bien été résilié. Vous conservez l'accès jusqu'à la fin de la période payée.
        </p>
        <p style="font-size:15px;color:#555;line-height:1.7">
          Vous pouvez vous réabonner à tout moment sur <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a>.
        </p>
        <p style="font-size:13px;color:#999">Une question ? <a href="mailto:contact.despy@gmail.com" style="color:#2D5BFF">contact.despy@gmail.com</a></p>
      </div>
    `
  }),

  // ── Email paiement échoué ──
  payment_failed: ({ name, email, attemptCount, invoiceUrl }) => ({
    subject: `⚠️ Problème de paiement Despy — Action requise`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:16px;margin-bottom:24px">
          <p style="font-size:15px;font-weight:700;color:#dc2626;margin:0">⚠️ Votre paiement Despy a échoué</p>
        </div>
        <p style="font-size:15px;color:#555;line-height:1.7">Bonjour <strong>${name}</strong>,</p>
        <p style="font-size:15px;color:#555;line-height:1.7">
          Nous n'avons pas pu prélever votre abonnement Despy 
          (tentative ${attemptCount}/3). 
          Pour éviter l'interruption de votre protection, veuillez mettre à jour votre moyen de paiement.
        </p>
        ${invoiceUrl ? `
        <div style="text-align:center;margin:28px 0">
          <a href="${invoiceUrl}" style="background:#dc2626;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
            Régulariser mon paiement →
          </a>
        </div>
        ` : ''}
        <p style="font-size:14px;color:#555;line-height:1.7">
          Si le paiement n'est pas régularisé dans les 7 jours, votre accès à Despy sera suspendu.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999;text-align:center">
          Une question ? <a href="mailto:contact.despy@gmail.com" style="color:#2D5BFF">contact.despy@gmail.com</a>
        </p>
      </div>
    `
  })
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { type, data } = JSON.parse(event.body || '{}');

    if (!type || !data || !data.email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'type et data.email requis' }) };
    }

    const template = templates[type];
    if (!template) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Template inconnu: ${type}` }) };
    }

    const { subject, html } = template(data);
    await sendResend(data.email, subject, html);

    console.log(`Email ${type} envoyé à ${data.email}`);
    return { statusCode: 200, headers, body: JSON.stringify({ sent: true }) };

  } catch (err) {
    console.error('Send email error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
