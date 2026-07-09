// ════════════════════════════════════════════
// DESPY — Service Email complet via Resend
// 7 templates : welcome, welcome_free, cancelled,
//               payment_failed, relance_lead,
//               monthly_report, cyber_alert
// + template custom (html/subject directs)
// Protégé par INTERNAL_SECRET
// ════════════════════════════════════════════

const crypto = require("crypto");

// Jeton de désinscription (identique à unsubscribe.js) pour le lien 1-clic.
function unsubToken(email) {
  const secret = process.env.INTERNAL_SECRET || process.env.SUPABASE_SERVICE_KEY || "despy";
  return crypto.createHmac("sha256", secret)
    .update((email || "").toLowerCase() + "|unsub")
    .digest("hex")
    .slice(0, 32);
}

const sendResend = async (to, subject, html) => {
  // En-tête List-Unsubscribe : améliore l'arrivée en boîte principale (Gmail
  // valorise les expéditeurs avec une désinscription en 1 clic) + conforme RGPD.
  const base = process.env.URL || "https://despy.fr";
  const unsubUrl = `${base}/.netlify/functions/unsubscribe?e=${encodeURIComponent(to)}&k=${unsubToken(to)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Despy <contact@despy.fr>",
      to: [to],
      subject,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>, <mailto:contact@despy.fr?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      }
    })
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));
  return res.json();
};

// ── Briques réutilisables (cohérence visuelle entre emails) ──
// L'en-tête reprend EXACTEMENT la couleur de fond du logo officiel (#010410) :
// le logo se fond parfaitement, quel que soit le client mail.
const brandHeader = (tagline) => `
  <div style="background:#010410;padding:28px 32px 22px;text-align:center">
    <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="150" style="color:#fff;font-size:22px;font-weight:900;width:150px;max-width:55%;height:auto;display:inline-block;border:0">
    <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:12px">${tagline || "Votre sécurité numérique, simplement"}</div>
  </div>
  <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>`;

const trustStrip = () => `<p style="font-size:13px;color:#999;line-height:1.6;text-align:center;margin:26px 0 0">🔒 Vos données sont hébergées en France 🇫🇷, chiffrées et jamais revendues. Conforme RGPD.</p>`;

const founderNote = () => `
  <div style="background:#f7f9fc;border-radius:14px;padding:20px 22px;margin:26px 0">
    <p style="font-size:15px;color:#444;line-height:1.65;margin:0;font-style:italic">« J'ai créé Despy parce que mes proches se faisaient piéger par des arnaques de plus en plus crédibles. Mon objectif : que vous ne soyez plus jamais seul face à un doute. »</p>
    <div style="font-size:14px;color:#0a1f3a;font-weight:700;margin-top:12px">Le fondateur de Despy, Strasbourg</div>
  </div>`;

const referralBlock = (code) => code ? `
  <div style="background:linear-gradient(135deg,#eff6ff,#fff);border:1.5px dashed #2D5BFF;border-radius:14px;padding:20px;margin:26px 0;text-align:center">
    <div style="font-size:14px;color:#555;margin-bottom:8px">🎁 <strong>Parrainez un proche</strong> — 1 mois offert pour chacun</div>
    <div style="font-size:24px;font-weight:900;color:#2D5BFF;letter-spacing:3px;font-family:monospace">${code}</div>
  </div>` : "";

// showPhone = true uniquement dans les emails destinés aux abonnés
// (le 06 personnel n'est pas exposé aux prospects/comptes gratuits).
const brandFooter = (showPhone) => `
  <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
  <div style="padding:26px 32px;text-align:center;background:#010410">
    <p style="font-size:14px;color:rgba(255,255,255,.75);margin:0 0 8px">Une question ? Écrivez-nous — un humain vous répond.</p>
    <p style="font-size:14px;color:#5BE3F5;margin:0;font-weight:600">contact@despy.fr${showPhone ? ' · 06 89 14 83 95' : ''}</p>
    <p style="font-size:11px;color:rgba(255,255,255,.45);margin:14px 0 0;line-height:1.6">Despy · cybersécurité pour tous · SIRET 103 694 212 00012<br><a href="https://despy.fr" style="color:#5BE3F5;text-decoration:none">despy.fr</a></p>
  </div>`;

const templates = {

  welcome: ({ name, prenom, plan, referralCode }) => {
    const PLAN_INFO = {
      monthly:        { label: 'Solo — Mensuel',    price: '9,99 €/mois',  cycle: 'chaque mois' },
      annual:         { label: 'Solo — Annuel',     price: '89 €/an',      cycle: 'chaque année' },
      family_monthly: { label: 'Famille — Mensuel', price: '14,99 €/mois', cycle: 'chaque mois' },
      family_annual:  { label: 'Famille — Annuel',  price: '139 €/an',     cycle: 'chaque année' }
    };
    const info = PLAN_INFO[plan] || PLAN_INFO.monthly;
    return {
    subject: `${prenom || name}, votre abonnement Despy est confirmé ✅`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Abonnement confirmé")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#0a1f3a">Bienvenue ${prenom || name} 🎉</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 20px">Votre abonnement <strong>${info.label}</strong> est actif. Vous êtes désormais protégé et accompagné, chaque jour, en toute simplicité. Voici le récapitulatif :</p>

        <div style="border:1px solid #e3e8f0;border-radius:14px;overflow:hidden;margin:22px 0">
          <div style="background:#0a1f3a;padding:13px 22px"><div style="font-size:13px;color:#5BE3F5;text-transform:uppercase;letter-spacing:.1em;font-weight:700">Récapitulatif de votre abonnement</div></div>
          <table style="width:100%;border-collapse:collapse;font-size:15px;color:#333">
            <tr><td style="padding:12px 22px;color:#777;border-bottom:1px solid #f0f0f0">Formule</td><td style="padding:12px 22px;text-align:right;font-weight:700;border-bottom:1px solid #f0f0f0">${info.label}</td></tr>
            <tr><td style="padding:12px 22px;color:#777;border-bottom:1px solid #f0f0f0">Montant</td><td style="padding:12px 22px;text-align:right;font-weight:700;border-bottom:1px solid #f0f0f0">${info.price}</td></tr>
            <tr><td style="padding:12px 22px;color:#777;border-bottom:1px solid #f0f0f0">Renouvellement</td><td style="padding:12px 22px;text-align:right;border-bottom:1px solid #f0f0f0">Automatique, ${info.cycle}</td></tr>
            <tr><td style="padding:12px 22px;color:#777">Engagement</td><td style="padding:12px 22px;text-align:right;color:#16a34a;font-weight:700">Aucun · résiliable en 1 clic</td></tr>
          </table>
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:20px 22px;margin:22px 0">
          <div style="font-size:14px;color:#1a3fd9;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Tout est inclus</div>
          <div style="font-size:16px;color:#333;line-height:2">✅ Questions <strong>illimitées</strong> à votre Conseiller Despy<br>✅ SOS humain : un conseiller au bout du fil<br>✅ <strong>Surveillance dark web chaque semaine</strong> : fuites + appareils infectés, alerte immédiate<br>✅ Alertes dès qu'une nouvelle arnaque circule<br>✅ Effacement de vos traces sur internet<br>✅ Bilan de sécurité personnalisé chaque mois</div>
        </div>

        <p style="font-size:14px;color:#666;line-height:1.7;margin:0 0 22px">Vous restez <strong>libre</strong> : résiliez à tout moment, en 1 clic, depuis votre espace (onglet « Mon compte »). Une question ? Répondez simplement à cet email, un humain vous répond.</p>

        <div style="text-align:center;margin:8px 0 28px">
          <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 34px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Accéder à mon espace</a>
        </div>

        ${founderNote()}
        ${referralBlock(referralCode)}
        ${trustStrip()}
      </div>
      ${brandFooter(true)}
    </div>`
    };
  },

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

  cancelled: ({ name, prenom }) => ({
    subject: "Votre résiliation est prise en compte — la porte reste ouverte",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("À bientôt, on l'espère")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 14px;font-size:23px;color:#0a1f3a;line-height:1.3">Votre résiliation est bien prise en compte</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 16px">Bonjour ${prenom || name || ''},</p>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 18px">C'est fait, sans engagement : vous conservez votre <strong>accès complet jusqu'à la fin de la période déjà payée</strong>, et aucun nouveau prélèvement ne sera effectué.</p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:18px 20px;margin:0 0 22px">
          <div style="font-size:14px;color:#9a3412;font-weight:700;margin-bottom:8px">Ensuite, vous n'aurez plus :</div>
          <div style="font-size:14px;color:#7c2d12;line-height:1.9">• le Conseiller pour vérifier vos messages douteux<br>• les alertes des arnaques en circulation<br>• le SOS humain en cas de problème<br>• le nettoyage de vos données personnelles</div>
        </div>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 4px">Les arnaques, elles, ne prennent pas de pause. <strong>La porte reste grande ouverte</strong> : revenez quand vous voulez, en un clic, et tout repart comme avant.</p>
        <div style="text-align:center;margin:24px 0">
          <a href="https://despy.fr/tarifs" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Réactiver ma protection</a>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:18px 20px">
          <div style="font-size:14px;color:#1a3fd9;font-weight:700;margin-bottom:6px">Une remarque, un souci ?</div>
          <div style="font-size:14px;color:#444;line-height:1.6">Dites-nous en deux mots ce qui n'a pas été — on lit tout, et ça nous aide à nous améliorer. Répondez simplement à cet email.</div>
        </div>
        ${trustStrip()}
      </div>
      ${brandFooter(true)}
    </div>`
  }),

  payment_failed: ({ name, prenom, attemptCount, invoiceUrl }) => ({
    subject: "Votre paiement Despy n'a pas abouti — réglons ça en 1 minute",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Paiement à mettre à jour")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 14px;font-size:23px;color:#0a1f3a;line-height:1.3">Un petit souci avec votre paiement</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 16px">Bonjour ${prenom || name || ''},</p>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 20px">Votre dernier paiement n'a pas pu être validé par votre banque — le plus souvent une carte expirée ou un plafond atteint. Pas d'inquiétude, ça se règle en une minute.</p>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:16px 20px;margin:0 0 24px">
          <div style="font-size:14px;color:#92400e;line-height:1.6"><strong>Tentative ${attemptCount || 1}/3.</strong> Votre protection Despy <strong>reste active</strong> pour le moment. Le plus simple est de mettre à jour votre moyen de paiement dès maintenant.</div>
        </div>
        ${invoiceUrl ? `<div style="text-align:center;margin:0 0 26px"><a href="${invoiceUrl}" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Mettre à jour mon paiement</a></div>` : ""}
        <div style="border-top:1px solid #eee;padding-top:20px">
          <p style="font-size:15px;color:#444;line-height:1.65;margin:0 0 6px"><strong>Pourquoi ça arrive&nbsp;?</strong></p>
          <p style="font-size:14px;color:#666;line-height:1.7;margin:0">Carte arrivée à expiration, plafond mensuel atteint, ou simple refus temporaire de la banque. Une fois la carte mise à jour, tout repart normalement — sans coupure.</p>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:18px 20px;margin:22px 0">
          <div style="font-size:14px;color:#1a3fd9;font-weight:700;margin-bottom:6px">Un doute&nbsp;? Un humain vous aide</div>
          <div style="font-size:14px;color:#444;line-height:1.6">Répondez simplement à cet email, ou appelez-nous. On vous accompagne, sans jargon.</div>
        </div>
        ${trustStrip()}
      </div>
      ${brandFooter(true)}
    </div>`
  }),

  relance_lead: ({ name, prenom }) => ({
    subject: "Et si on vérifiait les messages douteux à votre place ?",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Votre protection vous attend")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 14px;font-size:23px;color:#0a1f3a;line-height:1.3">Vous avez fait le premier pas 👏</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 18px">Bonjour ${prenom || name || ''},</p>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 20px">Vous vous êtes intéressé à Despy — et vous avez bien fait. En 2023, <strong>411 700 personnes</strong> ont été victimes d'escroqueries en France, et les arnaques sont de plus en plus crédibles (SMS, faux conseiller, voix clonée par IA…).</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:20px;margin:0 0 22px">
          <div style="font-size:15px;color:#1a3fd9;font-weight:800;margin-bottom:10px">Avec Despy, vous n'êtes plus seul face au doute</div>
          <div style="font-size:15px;color:#333;line-height:1.9">✅ Un message suspect&nbsp;? On vous dit en 10 sec si c'est une arnaque<br>✅ Un conseiller humain qui vous guide<br>✅ Des alertes sur les arnaques du moment<br>✅ Le nettoyage de vos données personnelles</div>
        </div>
        <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);border-radius:14px;padding:22px;text-align:center">
          <div style="font-size:13px;color:#5BE3F5;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Offre de lancement</div>
          <div style="font-size:22px;color:#fff;font-weight:900;margin-bottom:4px">89€/an — 2 mois offerts</div>
          <div style="font-size:13px;color:rgba(255,255,255,.78);margin-bottom:16px">Soit 7,42€/mois · sans engagement · résiliable en 1 clic</div>
          <a href="https://despy.fr/tarifs" style="display:inline-block;background:#fff;color:#1a3fd9;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px">Je me protège maintenant</a>
        </div>
        ${trustStrip()}
      </div>
      ${brandFooter()}
    </div>`
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
        ${brandHeader("Votre bilan mensuel")}
        <div style="background:#fff;padding:32px 24px 28px">
          <h1 style="margin:0 0 4px;font-size:24px;color:#0a1f3a">Votre mois Despy</h1>
          <p style="margin:0 0 18px;font-size:14px;color:#888">${monthName}</p>
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
          ${trustStrip()}
        </div>
        ${brandFooter(true)}
      </div>`
    };
  },

  cyber_alert: ({ prenom, alertTitle, alertDesc, alertLink, alertSource }) => ({
    subject: `🔴 Alerte Despy — ${(alertTitle || "").substring(0, 60)}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      <div style="background:#010410;padding:16px 32px;text-align:center">
        <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="92" style="color:#fff;font-size:22px;font-weight:900;width:92px;max-width:38%;height:auto;display:inline-block;border:0">
      </div>
      <div style="background:linear-gradient(135deg,#7f1d1d 0%,#dc2626 100%);padding:26px 32px;text-align:center">
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
      ${brandFooter(true)}
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

  // Livraison de l'aimant à leads : le guide PDF "5 arnaques qui visent vos parents"
  guide_delivery: ({ prenom, guideUrl }) => ({
    subject: "Votre guide Despy : les 5 arnaques qui visent vos parents",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Votre guide est prêt")}
      <div style="background:#fff;padding:36px 32px 30px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#0a1f3a;line-height:1.3">Voici votre guide${prenom ? ", " + prenom : ""} 🎁</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 26px">Merci de votre confiance. Prenez 5 minutes pour le lire, puis parlez-en avec vos proches : c'est souvent ce simple échange qui suffit à éviter le piège.</p>

        <div style="background:linear-gradient(135deg,#0a1f3a 0%,#122a4d 100%);border-radius:18px;padding:30px 24px;margin:0 0 28px;text-align:center">
          <img src="https://despy.fr/assets/guide-cover.png" width="190" alt="Couverture — Les 5 arnaques qui visent vos parents" style="width:190px;max-width:58%;height:auto;border-radius:10px;display:block;margin:0 auto 22px;box-shadow:0 14px 36px rgba(0,0,0,.5)">
          <div style="font-size:12px;color:#5BE3F5;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:7px">Guide PDF · 6 pages · gratuit</div>
          <div style="font-size:19px;color:#fff;font-weight:800;line-height:1.35;margin-bottom:22px">Les 5 arnaques qui visent vos parents</div>
          <a href="${guideUrl}" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Télécharger le guide</a>
        </div>

        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.12em;font-weight:700;margin:0 0 14px">Au programme</div>
        <div style="border:1px solid #edf0f5;border-radius:14px;overflow:hidden;margin:0 0 28px">
          <div style="padding:14px 18px;border-bottom:1px solid #f1f3f7;font-size:15.5px;color:#0a1f3a"><strong style="color:#2D5BFF">1</strong>&nbsp;&nbsp;Le faux SMS de colis</div>
          <div style="padding:14px 18px;border-bottom:1px solid #f1f3f7;font-size:15.5px;color:#0a1f3a"><strong style="color:#2D5BFF">2</strong>&nbsp;&nbsp;Le faux conseiller bancaire</div>
          <div style="padding:14px 18px;border-bottom:1px solid #f1f3f7;font-size:15.5px;color:#0a1f3a"><strong style="color:#2D5BFF">3</strong>&nbsp;&nbsp;Le faux support informatique</div>
          <div style="padding:14px 18px;border-bottom:1px solid #f1f3f7;font-size:15.5px;color:#0a1f3a"><strong style="color:#2D5BFF">4</strong>&nbsp;&nbsp;L'arnaque au faux proche</div>
          <div style="padding:14px 18px;font-size:15.5px;color:#0a1f3a"><strong style="color:#2D5BFF">5</strong>&nbsp;&nbsp;Le faux gain / faux cadeau&nbsp; <span style="color:#888;font-size:13.5px">+ la règle d'or</span></div>
        </div>

        ${founderNote()}

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:24px;margin:26px 0 0;text-align:center">
          <div style="font-size:17px;color:#1a3fd9;font-weight:800;margin-bottom:8px">Vous ne pouvez pas être derrière eux 24h/24.</div>
          <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 18px">Despy, si. Vos proches envoient un message douteux, on leur dit en quelques secondes si c'est une arnaque — avec un conseiller humain. Dès <strong>9,99€/mois</strong>, ou <strong>14,99€/mois en Famille</strong> (jusqu'à 4 proches).</p>
          <a href="https://despy.fr/tarifs" style="display:inline-block;background:#0a1f3a;color:#fff;padding:14px 30px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Protéger mes proches</a>
        </div>

        ${trustStrip()}
      </div>
      ${brandFooter()}
    </div>`
  }),

  // Guide de démarrage : le « mode d'emploi » complet de Despy, envoyé aux
  // nouveaux abonnés juste après la confirmation. À garder précieusement.
  welcome_guide: ({ name, prenom, referralCode }) => {
    const feat = (icon, iconBg, title, desc, how) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px">
        <tr>
          <td width="46" valign="top" style="padding:14px 0 14px 16px">
            <div style="width:40px;height:40px;border-radius:10px;background:${iconBg};text-align:center;line-height:40px;font-size:19px">${icon}</div>
          </td>
          <td valign="top" style="padding:13px 16px 13px 14px">
            <div style="font-size:15.5px;font-weight:800;color:#0a1f3a;line-height:1.35">${title}</div>
            <div style="font-size:13.5px;color:#555;line-height:1.55;margin-top:3px">${desc}</div>
            <div style="font-size:12.5px;color:#2D5BFF;font-weight:700;margin-top:5px">→ ${how}</div>
          </td>
        </tr>
      </table>`;
    const section = (label, rows) => `
      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.14em;font-weight:800;margin:26px 0 10px">${label}</div>
      <div style="border:1px solid #e8ecf3;border-radius:16px;background:#fcfdff">${rows}</div>`;
    return {
      subject: `${prenom || name}, voici tout ce que Despy sait faire pour vous 📖`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Votre guide de démarrage")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#0a1f3a">Votre mode d'emploi, ${prenom || name} 📖</h1>
        <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 6px">Despy fait beaucoup de choses pour vous — et le plus important tourne <strong>tout seul, sans rien faire</strong>. Voici le tour complet, en 2 minutes.</p>
        <p style="font-size:13.5px;color:#888;line-height:1.6;margin:0 0 8px">💡 Gardez cet email : c'est votre pense-bête Despy.</p>

        ${section("🚨 Un doute ? Trois réflexes", `
          ${feat("🔍", "#eef4ff", "L'Analyseur de messages", "Un SMS, un email ou un lien vous semble louche&nbsp;? Copiez-collez-le (ou envoyez une capture d'écran) : verdict clair en quelques secondes.", "despy.fr → « Vérifier un message »")}
          ${feat("💬", "#eef4ff", "Le Conseiller Despy — illimité", "Une question, même toute simple&nbsp;? Il répond 24h/24, en français clair, sans jargon, sans jugement.", "le bouton bleu « Aide » en bas à droite")}
          ${feat("🆘", "#fdeeee", "SOS Humain", "Compte piraté, carte volée, arnaque en cours&nbsp;: un humain vous rappelle et vous guide pas à pas, démarches comprises.", "le bouton rouge SOS, en bas de l'écran")}
        `)}

        ${section("🧰 Vos outils du quotidien", `
          ${feat("📞", "#f0fdf6", "L'annuaire inversé", "Un numéro inconnu vous a appelé&nbsp;? Vérifiez qui c'est avant de rappeler.", "Outils → « Numéro »")}
          ${feat("🛒", "#f0fdf6", "Le vérificateur de site marchand", "Avant d'acheter sur un site que vous ne connaissez pas, vérifiez qu'il est fiable.", "Outils → « Site marchand »")}
          ${feat("🔑", "#f0fdf6", "Vos mots de passe", "Vérifiez si un mot de passe a fuité (sans jamais nous l'envoyer) et générez-en des solides et faciles à retenir.", "Outils → « Mot de passe »")}
        `)}

        ${section("🛡️ Ce qui tourne tout seul pour vous", `
          ${feat("🕵️", "#f3f0ff", "Surveillance dark web — chaque semaine", "Nous vérifions si votre email apparaît dans une fuite de données ou si un de vos appareils est infecté par un virus voleur de mots de passe. Alerte immédiate par email et sur votre téléphone.", "rien à faire, on veille")}
          ${feat("🔔", "#f3f0ff", "Alertes arnaques nationales", "Quand une vague d'arnaque circule en France, vous êtes prévenu avant qu'elle ne vous atteigne.", "activez les notifications dans votre espace")}
          ${feat("🧹", "#f3f0ff", "Privacy Cleanup", "Vos nom, adresse et téléphone traînent sur des sites de données&nbsp;: nous envoyons les demandes légales d'effacement à votre place.", "espace Despy → « Effacer mes traces »")}
          ${feat("📊", "#f3f0ff", "Votre bilan mensuel", "Chaque mois, un récapitulatif personnalisé&nbsp;: ce qui a été bloqué, vérifié, nettoyé.", "directement dans votre boîte mail")}
        `)}

        ${section("🎓 Pour devenir imbattable", `
          ${feat("🏆", "#fff8ec", "La formation anti-arnaque", "9 modules simples, 45 quiz, des badges&nbsp;: apprenez à repérer tous les pièges, à votre rythme.", "espace Despy → « Formation »")}
          ${feat("🎭", "#fff8ec", "L'entraînement grandeur nature", "Despy vous envoie de fausses arnaques (sans danger) pour tester vos réflexes. Le meilleur exercice qui existe.", "espace Despy → « Entraînement »")}
          ${feat("👨‍👩‍👧", "#fff8ec", "Le cercle de confiance", "Désignez un proche&nbsp;: en cas d'alerte sérieuse, il est prévenu aussi. Personne ne reste seul face au doute.", "espace Despy → « Mon compte »")}
        `)}

        <div style="text-align:center;margin:30px 0 6px">
          <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:16px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Ouvrir mon espace Despy</a>
        </div>

        ${referralBlock(referralCode)}
        ${founderNote()}
        ${trustStrip()}
      </div>
      ${brandFooter(true)}
    </div>`
    };
  },

  // ════════════════════════════════════════════
  // MINI-FORMATION — séquence de nurture des leads du guide PDF.
  // Envoyée par nurture-leads.js sur ~8 jours. Chaque email apporte de la
  // valeur d'abord, l'offre vient en douceur à la fin.
  // ════════════════════════════════════════════

  // J+2 — Le piège n°1 en détail (valeur pure)
  nurture_j2: ({ prenom }) => ({
    subject: `${prenom || 'Bonjour'}, le piège n°1 des arnaques (à connaître absolument)`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Mini-formation · 1/4")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 12px;font-size:23px;color:#0a1f3a">Le faux SMS de colis 📦</h1>
        <p style="font-size:16px;color:#444;line-height:1.7;margin:0 0 18px">Bonjour ${prenom || ''}, vous avez récemment téléchargé notre guide — merci&nbsp;! Aujourd'hui on zoome sur <strong>l'arnaque la plus fréquente en France</strong>, celle qui piège le plus de gens.</p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:20px 22px;margin:0 0 20px">
          <div style="font-size:14px;font-weight:800;color:#d97706;margin-bottom:10px">🚩 Les 3 signes qui trahissent le faux SMS</div>
          <div style="font-size:14.5px;color:#444;line-height:1.9">
            1. Un <strong>lien</strong> à cliquer pour « payer des frais » ou « suivre le colis »<br>
            2. Un sentiment d'<strong>urgence</strong> (« sous 24h », « dernier avis »)<br>
            3. Une adresse web <strong>bizarre</strong> (laposte-suivi.info, colis-fr.com…)
          </div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:18px 20px;margin:0 0 22px">
          <div style="font-size:14px;font-weight:800;color:#166534;margin-bottom:6px">✅ Le bon réflexe</div>
          <div style="font-size:14.5px;color:#444;line-height:1.7">Ne cliquez <strong>jamais</strong> le lien. Ouvrez directement l'application officielle (La Poste, Chronopost…) ou tapez l'adresse à la main. Un vrai transporteur ne demande jamais de payer par SMS.</div>
        </div>
        <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 22px">💬 <strong>Un doute sur un message&nbsp;?</strong> Despy le vérifie pour vous en 10 secondes, gratuitement.</p>
        <div style="text-align:center;margin:0 0 6px">
          <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:15px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">Vérifier un message gratuitement</a>
        </div>
        <p style="font-size:13px;color:#999;text-align:center;margin:20px 0 0">À dans 2 jours pour le piège suivant 👋</p>
      </div>
      ${brandFooter()}
    </div>`
  }),

  // J+4 — Que faire si c'est déjà arrivé (rassure + montre le SOS)
  nurture_j4: ({ prenom }) => ({
    subject: `${prenom || 'Bonjour'}, et si vous aviez déjà cliqué ? (pas de panique)`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Mini-formation · 2/4")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 12px;font-size:23px;color:#0a1f3a">Vous avez cliqué ? Voici quoi faire</h1>
        <p style="font-size:16px;color:#444;line-height:1.7;margin:0 0 18px">Bonjour ${prenom || ''}, ça arrive aux plus prudents. Le plus important, c'est de <strong>réagir vite et dans le bon ordre</strong>. Pas de panique — voici les 3 réflexes.</p>
        <div style="border:1px solid #e8ecf3;border-radius:14px;overflow:hidden;margin:0 0 22px">
          <div style="padding:16px 20px;border-bottom:1px solid #f1f3f7;font-size:15px;color:#0a1f3a"><strong style="color:#dc2626">1.</strong>&nbsp; Ne saisissez <strong>plus rien</strong> et fermez la page immédiatement.</div>
          <div style="padding:16px 20px;border-bottom:1px solid #f1f3f7;font-size:15px;color:#0a1f3a"><strong style="color:#dc2626">2.</strong>&nbsp; <strong>Appelez votre banque</strong> (numéro au dos de la carte) pour faire opposition si vous avez donné une info bancaire.</div>
          <div style="padding:16px 20px;font-size:15px;color:#0a1f3a"><strong style="color:#dc2626">3.</strong>&nbsp; <strong>Changez le mot de passe</strong> du compte concerné depuis un autre appareil.</div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:18px 20px;margin:0 0 22px">
          <div style="font-size:14px;font-weight:800;color:#1a3fd9;margin-bottom:6px">🆘 Avec Despy, vous n'êtes pas seul</div>
          <div style="font-size:14.5px;color:#444;line-height:1.7">Notre bouton <strong>SOS</strong> vous met en relation avec un humain qui vous guide pas à pas, rédige les démarches et vous rassure. Personne ne reste seul face au doute.</div>
        </div>
        <div style="text-align:center;margin:0 0 6px">
          <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;padding:15px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">Découvrir Despy</a>
        </div>
        <p style="font-size:13px;color:#999;text-align:center;margin:20px 0 0">Dans 2 jours : une histoire vraie qui fait réfléchir 👀</p>
      </div>
      ${brandFooter()}
    </div>`
  }),

  // J+6 — Histoire illustrative + preuve sociale (les 17 avis)
  nurture_j6: ({ prenom }) => ({
    subject: `${prenom || 'Bonjour'}, elle a failli virer 4 800 € à un faux conseiller`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Mini-formation · 3/4")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 12px;font-size:22px;color:#0a1f3a">« Votre compte est piraté, virez vite… »</h1>
        <p style="font-size:16px;color:#444;line-height:1.7;margin:0 0 16px">Bonjour ${prenom || ''}, voici un scénario que nous voyons <strong>très souvent</strong> (exemple représentatif) :</p>
        <div style="background:#f8fafc;border-left:4px solid #2D5BFF;border-radius:0 12px 12px 0;padding:16px 20px;margin:0 0 20px;font-size:15px;color:#444;line-height:1.7;font-style:italic">
          Un « conseiller de votre banque » appelle, très rassurant. Il connaît votre nom, votre agence. Il dit qu'un pirate tente un virement et qu'il faut « sécuriser » votre argent en le virant sur un compte tampon. La victime, sous pression, s'exécute… C'est <strong>l'arnaque au faux conseiller bancaire</strong>.
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:18px 20px;margin:0 0 24px">
          <div style="font-size:14px;font-weight:800;color:#166534;margin-bottom:6px">🛡️ La règle d'or</div>
          <div style="font-size:14.5px;color:#444;line-height:1.7">Votre banque ne vous demandera <strong>jamais</strong> de virer de l'argent « pour le protéger », ni un code reçu par SMS. Raccrochez, et rappelez le numéro officiel au dos de votre carte.</div>
        </div>
        <div style="border:1px solid #fbbf24;border-radius:16px;padding:22px;text-align:center;margin:0 0 8px;background:linear-gradient(180deg,#fffdf5,#fff)">
          <div style="font-size:30px;font-weight:900;color:#0a1f3a">5,0 <span style="color:#FBBF24;font-size:22px">★★★★★</span></div>
          <div style="font-size:12px;color:#888;margin-bottom:12px">17 avis Google vérifiés</div>
          <div style="font-size:14.5px;color:#444;line-height:1.7;font-style:italic">« Avec Despy, je me sens enfin pleinement rassuré face à toutes les arnaques. Je recommande fortement. »</div>
          <div style="font-size:12px;color:#888;margin-top:8px">— Kevin K., client Despy</div>
        </div>
        <p style="font-size:13px;color:#999;text-align:center;margin:22px 0 0">Dernier email dans 2 jours 🎁</p>
      </div>
      ${brandFooter()}
    </div>`
  }),

  // J+8 — L'offre, en douceur (avec l'angle famille)
  nurture_j8: ({ prenom }) => ({
    subject: `${prenom || 'Bonjour'}, protégez vos proches (dès 9,99€/mois)`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
      ${brandHeader("Mini-formation · 4/4")}
      <div style="background:#fff;padding:36px 32px">
        <h1 style="margin:0 0 12px;font-size:23px;color:#0a1f3a">Vous ne pouvez pas être derrière eux 24h/24.</h1>
        <p style="font-size:16px;color:#444;line-height:1.7;margin:0 0 18px">Despy, si. En 4 emails, vous avez vu à quel point les arnaques sont crédibles aujourd'hui. La bonne nouvelle : <strong>vous (ou vos parents) n'avez plus à affronter ça seul.</strong></p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:22px;margin:0 0 22px">
          <div style="font-size:15px;color:#1a3fd9;font-weight:800;margin-bottom:10px">Tout ce que Despy fait pour vous</div>
          <div style="font-size:15px;color:#333;line-height:2">✅ Un message suspect&nbsp;? Verdict en 10 secondes<br>✅ Un conseiller humain qui vous guide<br>✅ Surveillance de vos données chaque semaine<br>✅ SOS humain en cas de problème</div>
        </div>
        <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);border-radius:16px;padding:24px;text-align:center;color:#fff;margin:0 0 22px">
          <div style="font-size:22px;font-weight:900;margin-bottom:2px">Dès 9,99€/mois</div>
          <div style="font-size:14px;opacity:.85;margin-bottom:4px">ou <strong>14,99€/mois en Famille</strong> — jusqu'à 4 proches</div>
          <div style="font-size:12px;opacity:.75;margin-bottom:16px">Sans engagement · résiliable en 1 clic · satisfait ou remboursé 30 jours</div>
          <a href="https://despy.fr/tarifs" style="display:inline-block;background:#fff;color:#1a3fd9;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px">Je protège ma famille →</a>
        </div>
        ${founderNote()}
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
