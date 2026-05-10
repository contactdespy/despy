// ════════════════════════════════════════════
// DESPY — Service Email complet via Resend
// 7 templates : welcome, welcome_free, cancelled,
//               payment_failed, relance_lead,
//               monthly_report, cyber_alert
// + template custom (html/subject directs)
// Protégé par INTERNAL_SECRET
// ════════════════════════════════════════════

const sendResend = async (to, subject, html) => {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: "Despy <contact@despy.fr>", to: [to], subject, html })
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));
  return res.json();
};

const templates = {

  welcome: ({ name, prenom, plan }) => ({
    subject: "Bienvenue dans Despy — Votre protection est active",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px"><h1 style="color:#2D5BFF">Bienvenue ${prenom || name} !</h1><p>Votre abonnement Despy ${plan === "annual" ? "Annuel" : "Mensuel"} est actif.</p><p>✅ Questions illimitées au Conseiller Despy<br>✅ Defi Chrono hebdomadaire<br>✅ Rapport mensuel personnalisé<br>✅ Alertes cybermenaces en temps réel</p><a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Accéder à mon espace</a></div>`
  }),

  welcome_free: ({ name, prenom }) => ({
    subject: "Votre compte Despy est créé !",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px"><h1 style="color:#2D5BFF">Bienvenue ${prenom || name} !</h1><p>Votre compte gratuit est actif. Vous avez <strong>3 questions offertes</strong>.</p><p>Avec l'abonnement : questions illimitées, Défi Chrono, rapport mensuel, alertes cybermenaces.</p><a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Accéder à mon espace</a></div>`
  }),

  cancelled: ({ name }) => ({
    subject: "Votre abonnement Despy a été résilié",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px"><p>Bonjour ${name},</p><p>Votre abonnement Despy a bien été résilié. Accès conservé jusqu'à la fin de la période payée.</p><a href="https://despy.fr" style="color:#2D5BFF">Se réabonner</a></div>`
  }),

  payment_failed: ({ name, attemptCount, invoiceUrl }) => ({
    subject: "Problème de paiement Despy — Action requise",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px"><h2 style="color:#dc2626">Paiement échoué</h2><p>Bonjour ${name},</p><p>Tentative ${attemptCount}/3 échouée. Mettez à jour votre moyen de paiement.</p>${invoiceUrl ? `<a href="${invoiceUrl}" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Régulariser mon paiement</a>` : ""}</div>`
  }),

  relance_lead: ({ name, prenom }) => ({
    subject: "Despy — Protégez-vous dès aujourd'hui",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px"><p>Bonjour ${prenom || name},</p><p>504 000 Français victimes de cyberattaque l'an dernier. Avec Despy, vous êtes guidé.</p><p><strong>Offre spéciale : 89€/an — 2 mois offerts</strong></p><a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Je me protège maintenant</a></div>`
  }),

  monthly_report: ({ name, prenom, monthName, stats }) => {
    const s = stats || {};
    const analyses = s.analyses || 0;
    const scams = s.scams_blocked || 0;
    const quizzes = s.quizzes || 0;
    const breaches = s.breaches || 0;
    const bonusMonths = s.bonus_months || 0;
    const refCode = s.referral_code || '';
    const intro = scams > 0
      ? `Ce mois-ci, Despy a détecté <strong>${scams} arnaque${scams > 1 ? 's' : ''}</strong> avant qu'elle${scams > 1 ? 's' : ''} ne vous touche${scams > 1 ? 'nt' : ''}. Bravo d'avoir le réflexe de vérifier !`
      : analyses > 0
        ? `Vous avez analysé <strong>${analyses} message${analyses > 1 ? 's' : ''}</strong> ce mois-ci. C'est ce réflexe qui vous protège.`
        : `Ce mois-ci a été calme — aucune analyse demandée. Pensez à utiliser l'analyseur dès qu'un message vous semble suspect.`;
    return {
      subject: `Votre bilan Despy — ${monthName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
        <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:36px 24px;color:#fff;text-align:center">
          <div style="font-size:11px;letter-spacing:.18em;opacity:.7;text-transform:uppercase;margin-bottom:6px">Bilan mensuel</div>
          <h1 style="margin:0;font-size:26px">Votre mois Despy</h1>
          <p style="margin:6px 0 0;opacity:.8">${monthName}</p>
        </div>
        <div style="background:#fff;padding:28px 24px">
          <p>Bonjour ${prenom || name},</p>
          <p>${intro}</p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;text-align:center">
              <div style="font-size:28px;font-weight:900;color:#16a34a">${scams}</div>
              <div style="font-size:12px;color:#555">arnaque${scams > 1 ? 's' : ''} bloquée${scams > 1 ? 's' : ''}</div>
            </div>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;text-align:center">
              <div style="font-size:28px;font-weight:900;color:#2D5BFF">${analyses}</div>
              <div style="font-size:12px;color:#555">analyse${analyses > 1 ? 's' : ''} effectuée${analyses > 1 ? 's' : ''}</div>
            </div>
            <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px;text-align:center">
              <div style="font-size:28px;font-weight:900;color:#d97706">${quizzes}</div>
              <div style="font-size:12px;color:#555">quiz complété${quizzes > 1 ? 's' : ''}</div>
            </div>
            <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:16px;text-align:center">
              <div style="font-size:28px;font-weight:900;color:${breaches > 0 ? '#dc2626' : '#16a34a'}">${breaches}</div>
              <div style="font-size:12px;color:#555">fuite${breaches > 1 ? 's' : ''} dark web</div>
            </div>
          </div>

          ${refCode ? `<div style="background:linear-gradient(135deg,#eff6ff,#fff);border:1.5px dashed #2D5BFF;border-radius:14px;padding:18px;margin:18px 0;text-align:center">
            <div style="font-size:13px;color:#555;margin-bottom:6px">🎁 <strong>Parrainez vos proches</strong> · 1 mois offert pour chacun</div>
            <div style="font-size:24px;font-weight:900;color:#2D5BFF;letter-spacing:3px;font-family:monospace">${refCode}</div>
            ${bonusMonths > 0 ? `<div style="font-size:12px;color:#16a34a;margin-top:6px"><strong>${bonusMonths} mois bonus</strong> déjà gagné${bonusMonths > 1 ? 's' : ''}</div>` : ''}
          </div>` : ''}

          <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px;border-radius:0 10px 10px 0;margin:16px 0;font-size:14px">
            <strong>Arnaque du mois :</strong> Les SMS imitant La Poste, Chronopost et Ameli sont en hausse. Ne cliquez jamais sur un lien — passez par l'app officielle ou tapez l'adresse à la main.
          </div>

          <div style="text-align:center;margin:24px 0">
            <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700">Ouvrir mon espace</a>
          </div>
          <p style="font-size:11px;color:#aaa;text-align:center">Despy · cybersécurité simple · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
        </div>
      </div>`
    };
  },

  cyber_alert: ({ prenom, alertTitle, alertDesc, alertLink, alertSource }) => ({
    subject: `Alerte Despy — ${(alertTitle || "").substring(0, 50)}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#dc2626;padding:20px 28px;color:#fff"><strong>ALERTE — ${alertSource || "ANSSI"}</strong><h2 style="margin:6px 0">${alertTitle}</h2></div><div style="padding:28px"><p>Bonjour ${prenom},</p><p>Une nouvelle menace détectée par <strong>${alertSource}</strong>. En tant que membre Despy, vous êtes informé en priorité.</p><div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:16px;margin:16px 0">${(alertDesc || "").substring(0, 400)}...</div>${alertLink ? `<div style="text-align:center;margin:16px 0"><a href="${alertLink}" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Lire l'alerte complète</a></div>` : ""}<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px;margin:16px 0">Posez vos questions à votre <a href="https://despy.fr" style="color:#2D5BFF">Conseiller Despy</a> pour savoir si vous êtes concerné.</div></div></div>`
  }),

  // Template passthrough : html et subject fournis directement par l'appelant
  custom: ({ subject, html }) => ({ subject, html })
};

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "{}" };

  // Vérification secret interne (toutes les fonctions Netlify doivent le fournir)
  const secret = process.env.INTERNAL_SECRET;
  if (secret && event.headers["x-internal-secret"] !== secret) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }

  try {
    const { type, data } = JSON.parse(event.body || "{}");
    if (!type || !data || !data.email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "type et email requis" }) };
    }

    const templateFn = templates[type];
    if (!templateFn) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Template inconnu: ${type}` }) };
    }

    const { subject, html } = templateFn(data);
    await sendResend(data.email, subject, html);
    console.log(`Email ${type} -> ${data.email}`);
    return { statusCode: 200, headers, body: JSON.stringify({ sent: true }) };

  } catch (err) {
    console.error("Email error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
