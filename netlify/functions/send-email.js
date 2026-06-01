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

// ── Briques réutilisables (cohérence visuelle entre emails) ──
const brandHeader = (tagline) => `
  <div style="background:linear-gradient(135deg,#0a1f3a 0%,#1a3fd9 100%);padding:38px 32px;text-align:center">
    <div style="font-size:26px;font-weight:900;color:#fff;letter-spacing:.5px">Despy</div>
    <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:6px">${tagline || "Votre sécurité numérique, simplement"}</div>
  </div>`;

const trustStrip = () => `<p style="font-size:13px;color:#999;line-height:1.6;text-align:center;margin:26px 0 0">🔒 Vos données sont hébergées en France 🇫🇷, chiffrées et jamais revendues. Conforme RGPD.</p>`;

const founderNote = () => `
  <div style="background:#f7f9fc;border-radius:14px;padding:20px 22px;margin:26px 0">
    <p style="font-size:15px;color:#444;line-height:1.65;margin:0;font-style:italic">« J'ai créé Despy parce que mes proches se faisaient piéger par des arnaques de plus en plus crédibles. Mon objectif : que vous ne soyez plus jamais seul face à un doute. »</p>
    <div style="font-size:14px;color:#0a1f3a;font-weight:700;margin-top:12px">Yacine — fondateur de Despy, Strasbourg</div>
  </div>`;

const referralBlock = (code) => code ? `
  <div style="background:linear-gradient(135deg,#eff6ff,#fff);border:1.5px dashed #2D5BFF;border-radius:14px;padding:20px;margin:26px 0;text-align:center">
    <div style="font-size:14px;color:#555;margin-bottom:8px">🎁 <strong>Parrainez un proche</strong> — 1 mois offert pour chacun</div>
    <div style="font-size:24px;font-weight:900;color:#2D5BFF;letter-spacing:3px;font-family:monospace">${code}</div>
  </div>` : "";

const brandFooter = () => `
  <div style="padding:26px 32px;text-align:center;background:#0a1f3a">
    <p style="font-size:14px;color:rgba(255,255,255,.7);margin:0 0 8px">Une question ? Écrivez-nous — un humain vous répond.</p>
    <p style="font-size:14px;color:#5BE3F5;margin:0;font-weight:600">contact@despy.fr · 06 89 14 83 95</p>
    <p style="font-size:11px;color:rgba(255,255,255,.4);margin:14px 0 0;line-height:1.6">Despy · cybersécurité pour tous · SIRET 103 694 212 00012<br><a href="https://despy.fr" style="color:#5BE3F5;text-decoration:none">despy.fr</a></p>
  </div>`;

const templates = {

  welcome: ({ name, prenom, plan, referralCode }) => ({
    subject: `${prenom || name}, votre protection Despy est active ✅`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Votre protection est active")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#0a1f3a">Bienvenue ${prenom || name} 🎉</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 20px">Votre abonnement <strong>${plan === "annual" ? "Annuel" : "Mensuel"}</strong> est actif. Vous êtes désormais protégé et accompagné, chaque jour, en toute simplicité.</p>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:20px 22px;margin:22px 0">
          <div style="font-size:14px;color:#1a3fd9;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Tout est inclus</div>
          <div style="font-size:16px;color:#333;line-height:2">✅ Questions <strong>illimitées</strong> à votre Conseiller Despy<br>✅ SOS humain : un conseiller au bout du fil<br>✅ Alertes dès qu'une nouvelle arnaque circule<br>✅ Effacement de vos traces sur internet<br>✅ Bilan de sécurité personnalisé chaque mois</div>
        </div>

        <div style="text-align:center;margin:28px 0">
          <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 34px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Accéder à mon espace</a>
        </div>

        ${founderNote()}
        ${referralBlock(referralCode)}
        ${trustStrip()}
      </div>
      ${brandFooter()}
    </div>`
  }),

  welcome_free: ({ name, prenom, referralCode }) => ({
    subject: `${prenom || name}, bienvenue chez Despy — votre compte est prêt`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader()}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#0a1f3a">Bienvenue ${prenom || name} 👋</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 20px">Votre compte Despy est créé. Vous rejoignez une communauté qui apprend, sereinement, à déjouer les arnaques et les pièges du numérique — sans jargon, à votre rythme.</p>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:22px;margin:22px 0;text-align:center">
          <div style="font-size:17px;color:#1a3fd9;font-weight:800;margin-bottom:8px">🎁 Vous avez 3 questions offertes</div>
          <div style="font-size:15px;color:#555;line-height:1.6">Un SMS suspect, un appel douteux, un mail bizarre ? Posez la question à votre Conseiller Despy : il vous répond clairement, en français simple.</div>
        </div>

        <div style="text-align:center;margin:28px 0">
          <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 34px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Poser ma première question</a>
        </div>

        <div style="border-top:1px solid #eee;padding-top:22px">
          <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:12px">Ce que Despy fait aussi pour vous</div>
          <div style="font-size:16px;color:#333;line-height:2">🆘 Un humain au bout du fil avec le SOS Despy<br>🔔 Des alertes quand une nouvelle arnaque circule<br>🧹 L'effacement de vos traces sur internet</div>
        </div>

        ${founderNote()}
        ${referralBlock(referralCode)}
        ${trustStrip()}
      </div>
      ${brandFooter()}
    </div>`
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
    subject: `🔴 Alerte Despy — ${(alertTitle || "").substring(0, 60)}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      <div style="background:linear-gradient(135deg,#7f1d1d 0%,#dc2626 100%);padding:30px 32px;text-align:center">
        <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#fecaca;font-weight:700">Alerte cybersécurité · ${alertSource || "ANSSI"}</div>
        <div style="font-size:22px;font-weight:900;color:#fff;margin-top:8px;line-height:1.3">${alertTitle || "Nouvelle menace détectée"}</div>
      </div>
      <div style="background:#fff;padding:32px">
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 16px">Bonjour ${prenom || "cher membre"},</p>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 18px">Une nouvelle menace vient d'être repérée par <strong>${alertSource || "l'ANSSI"}</strong>. En tant que membre Despy, vous êtes prévenu en priorité.</p>
        <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 12px 12px 0;padding:18px 20px;margin:18px 0;font-size:15px;color:#333;line-height:1.6">${(alertDesc || "").substring(0, 400)}${(alertDesc || "").length > 400 ? "…" : ""}</div>
        ${alertLink ? `<div style="text-align:center;margin:24px 0"><a href="${alertLink}" style="display:inline-block;background:#dc2626;color:#fff;padding:15px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Lire l'alerte complète</a></div>` : ""}
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:18px;margin:20px 0;font-size:15px;color:#333;line-height:1.6">💬 Un doute sur un message que vous avez reçu ? Posez la question à votre <a href="https://despy.fr" style="color:#2D5BFF;font-weight:700;text-decoration:none">Conseiller Despy</a> : il vous dira clairement si vous êtes concerné.</div>
        ${trustStrip()}
      </div>
      ${brandFooter()}
    </div>`
  }),

  // Version "teaser" envoyée aux comptes gratuits (incite à s'abonner)
  cyber_alert_free: ({ prenom, alertTitle, alertSource }) => ({
    subject: `🔴 Une arnaque circule en ce moment — ${(alertTitle || "").substring(0, 50)}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Alerte cybersécurité")}
      <div style="background:#fff;padding:32px">
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 16px">Bonjour ${prenom || "cher membre"},</p>
        <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 12px 12px 0;padding:18px 20px;margin:0 0 18px">
          <div style="font-size:11px;color:#dc2626;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Menace repérée · ${alertSource || "ANSSI"}</div>
          <div style="font-size:17px;font-weight:800;color:#0a1f3a;line-height:1.35">${alertTitle || "Nouvelle arnaque en circulation"}</div>
        </div>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 18px">Despy surveille en continu les arnaques qui visent les particuliers. <strong>Les abonnés reçoivent chaque alerte en détail</strong> et peuvent demander à leur Conseiller s'ils sont concernés.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:20px;margin:18px 0;text-align:center">
          <div style="font-size:16px;color:#1a3fd9;font-weight:800;margin-bottom:6px">Soyez protégé pour 9,99€/mois</div>
          <div style="font-size:14px;color:#555;line-height:1.6">Alertes détaillées en temps réel · Conseiller illimité · SOS humain · sans engagement</div>
        </div>
        <div style="text-align:center;margin:24px 0">
          <a href="https://despy.fr/tarifs" style="display:inline-block;background:#2D5BFF;color:#fff;padding:15px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Activer ma protection</a>
        </div>
        ${trustStrip()}
      </div>
      ${brandFooter()}
    </div>`
  }),

  // Sensibilisation : arnaques générées par IA (peut être envoyé aux gratuits comme aux abonnés)
  ia_scams_awareness: ({ name, prenom, referralCode }) => ({
    subject: `Les arnaques sont maintenant écrites par une IA — voici comment les repérer`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Nouvelle menace 2026")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 14px;font-size:23px;color:#0a1f3a;line-height:1.3">Bonjour ${prenom || name || "cher membre"},</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 18px">Pendant des années, on a appris à repérer une arnaque grâce aux fautes d'orthographe et aux tournures bizarres. Ce réflexe ne suffit plus.</p>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 22px">Aujourd'hui, les escrocs utilisent l'<strong>intelligence artificielle</strong> pour écrire des messages parfaits, sans la moindre faute. Voici les trois pièges du moment :</p>

        <div style="border:1px solid #eee;border-radius:14px;overflow:hidden;margin:0 0 24px">
          <div style="padding:18px 20px;border-bottom:1px solid #eee">
            <div style="font-size:16px;font-weight:800;color:#0a1f3a;margin-bottom:4px">📧 Faux emails &amp; SMS parfaits</div>
            <div style="font-size:14px;color:#555;line-height:1.6">Plus aucune faute pour vous alerter. Le message semble venir de votre banque, de La Poste ou des impôts.</div>
          </div>
          <div style="padding:18px 20px;border-bottom:1px solid #eee">
            <div style="font-size:16px;font-weight:800;color:#0a1f3a;margin-bottom:4px">🌐 Faux sites copiés à l'identique</div>
            <div style="font-size:14px;color:#555;line-height:1.6">L'IA recrée des sites quasi parfaits pour voler vos identifiants. À l'œil nu, impossible de faire la différence.</div>
          </div>
          <div style="padding:18px 20px">
            <div style="font-size:16px;font-weight:800;color:#0a1f3a;margin-bottom:4px">📞 Voix de proches imitées</div>
            <div style="font-size:14px;color:#555;line-height:1.6">« Maman, c'est moi, j'ai un problème… » — l'IA peut copier une voix à partir d'une simple vidéo en ligne.</div>
          </div>
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:22px;margin:0 0 22px">
          <div style="font-size:15px;color:#1a3fd9;font-weight:800;margin-bottom:8px">Ce que change Despy</div>
          <p style="font-size:15px;color:#333;line-height:1.65;margin:0">Despy n'analyse pas la qualité de l'écriture — il analyse le <strong>contenu et l'intention</strong> du message. Peu importe qui l'a écrit, un humain ou une IA. <strong>Copiez-collez un message douteux</strong>, on vous dit en quelques secondes si c'est une arnaque.</p>
        </div>

        <div style="background:#fffbeb;border-left:4px solid #FBBF24;border-radius:0 12px 12px 0;padding:16px 20px;margin:0 0 24px">
          <div style="font-size:14px;font-weight:800;color:#92400e;margin-bottom:6px">Pour les appels à la voix imitée</div>
          <p style="font-size:14px;color:#555;line-height:1.6;margin:0">Le bon réflexe : raccrochez, rappelez votre proche sur son vrai numéro, ou posez une question dont seule la vraie personne connaît la réponse. Despy vous apprend à garder ce réflexe sans paniquer.</p>
        </div>

        <div style="text-align:center;margin:28px 0">
          <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 34px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Analyser un message gratuitement</a>
        </div>

        ${founderNote()}
        ${referralBlock(referralCode)}
        ${trustStrip()}
      </div>
      ${brandFooter()}
    </div>`
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
