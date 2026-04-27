// ════════════════════════════════════════════
// DESPY — Emails automatiques via Resend
// Netlify Function : /.netlify/functions/send-email
// Utilisé par : stripe-webhook (bienvenue + hebdo)
// ════════════════════════════════════════════
// Resend.com : gratuit jusqu'à 3000 emails/mois
// Créer un compte sur resend.com → API Keys → copier dans Netlify

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'Despy <bonjour@despy.fr>';
const REPLY_TO = 'contact@despy.fr';

// ── Template email bienvenue ──
function welcomeEmail({ name, email, plan }) {
  const planLabel = plan === 'annual' ? 'annuel (89€/an)' : 'mensuel (9,99€/mois)';
  const appUrl = 'https://despy.fr/despy_app_v21.html';

  return {
    subject: `Bienvenue dans Despy, ${name} ! 🛡️`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:580px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#030810,#071428);padding:32px 32px 24px;text-align:center">
      <div style="font-family:'Helvetica Neue',sans-serif;font-size:22px;font-weight:800;color:#00d4ff;letter-spacing:-0.5px;margin-bottom:4px">DESPY</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:2px">Cybersécurité pour particuliers</div>
    </div>

    <!-- Body -->
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#0a1525;margin:0 0 8px">Bienvenue, ${name} !</h1>
      <p style="font-size:15px;color:#4a5568;line-height:1.7;margin:0 0 24px">Votre abonnement <strong>${planLabel}</strong> est actif. Vous avez maintenant accès à l'ensemble des fonctionnalités Despy.</p>

      <!-- Statut -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin-bottom:24px;display:flex;align-items:center;gap:12px">
        <div style="font-size:24px">✅</div>
        <div>
          <div style="font-weight:700;color:#166534;font-size:14px">Protection active</div>
          <div style="font-size:13px;color:#4b7065;margin-top:2px">Surveillance dark web · Assistant Despy · SOS Urgence · Formation complète</div>
        </div>
      </div>

      <!-- 3 premières choses -->
      <h2 style="font-size:16px;font-weight:700;color:#0a1525;margin:0 0 14px">Par où commencer ?</h2>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px">
        <div style="background:#f8fafc;border-radius:10px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
          <div style="width:28px;height:28px;border-radius:8px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">1</div>
          <div>
            <div style="font-weight:600;font-size:14px;color:#0a1525;margin-bottom:2px">Lancez votre premier audit de sécurité</div>
            <div style="font-size:13px;color:#64748b">Découvrez votre score et les vulnérabilités à corriger</div>
          </div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
          <div style="width:28px;height:28px;border-radius:8px;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">2</div>
          <div>
            <div style="font-weight:600;font-size:14px;color:#0a1525;margin-bottom:2px">Vérifiez si votre email a été compromis</div>
            <div style="font-size:13px;color:#64748b">Analyse dark web en temps réel sur vos adresses</div>
          </div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
          <div style="width:28px;height:28px;border-radius:8px;background:#f0fdf4;color:#16a34a;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">3</div>
          <div>
            <div style="font-weight:600;font-size:14px;color:#0a1525;margin-bottom:2px">Activez les notifications de sécurité</div>
            <div style="font-size:13px;color:#64748b">Alertes immédiates en cas de nouvelle menace</div>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px">
        <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#0055ff,#00d4ff);color:#000;font-weight:800;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none">
          Accéder à mon espace Despy →
        </a>
      </div>

      <p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:0">Des questions ? Répondez directement à cet email ou écrivez à <a href="mailto:contact@despy.fr" style="color:#0055ff">contact@despy.fr</a> — je réponds sous 24h.</p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center">
      <div style="font-size:12px;color:#94a3b8;line-height:1.7">
        Despy · Yacine Bourefis EI · SIRET 103 694 212 00012<br>
        33 rue de la Klebsau, 67100 Strasbourg<br>
        <a href="https://despy.fr" style="color:#64748b;text-decoration:none">despy.fr</a> · <a href="https://despy.fr?page=resiliation" style="color:#64748b;text-decoration:none">Résilier</a>
      </div>
    </div>
  </div>
</body>
</html>`,
  };
}

// ── Template email rapport hebdomadaire ──
function weeklyReportEmail({ name, email, score, streak, badges, topThreat }) {
  const scoreColor = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#dc2626';
  const scoreLabel = score >= 70 ? 'Excellente protection' : score >= 40 ? 'Protection modérée' : 'Attention requise';
  const week = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

  return {
    subject: `Votre rapport Despy — semaine du ${week} 🛡️`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:580px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

    <div style="background:linear-gradient(135deg,#030810,#071428);padding:28px 32px 20px;text-align:center">
      <div style="font-family:'Helvetica Neue',sans-serif;font-size:20px;font-weight:800;color:#00d4ff;letter-spacing:-0.5px;margin-bottom:4px">DESPY</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:2px">Rapport hebdomadaire</div>
    </div>

    <div style="padding:28px 32px">
      <p style="font-size:15px;color:#4a5568;margin:0 0 24px">Bonjour ${name}, voici votre bilan de sécurité de la semaine.</p>

      <!-- Score -->
      <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center">
        <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600">Votre score de sécurité</div>
        <div style="font-size:52px;font-weight:800;color:${scoreColor};line-height:1">${score}<span style="font-size:22px;color:#94a3b8">/100</span></div>
        <div style="font-size:13px;color:${scoreColor};margin-top:6px;font-weight:600">${scoreLabel}</div>
      </div>

      <!-- Stats rapides -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px">
        <div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#0055ff">${streak}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">jours de streak</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#7c3aed">${badges}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">badges obtenus</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#16a34a">✓</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">protection active</div>
        </div>
      </div>

      <!-- Menace de la semaine -->
      ${topThreat ? `
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin-bottom:20px">
        <div style="font-weight:700;color:#c2410c;font-size:13px;margin-bottom:4px">⚠️ Arnaque de la semaine en France</div>
        <div style="font-size:13px;color:#9a3412;line-height:1.6">${topThreat}</div>
      </div>` : ''}

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:20px">
        <a href="https://despy.fr/despy_app_v21.html" style="display:inline-block;background:linear-gradient(135deg,#0055ff,#00d4ff);color:#000;font-weight:800;font-size:14px;padding:13px 32px;border-radius:10px;text-decoration:none">
          Voir mon tableau de bord complet →
        </a>
      </div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">Despy · <a href="https://despy.fr?page=resiliation" style="color:#94a3b8">Se désabonner des rapports</a></p>
    </div>
  </div>
</body>
</html>`,
  };
}

// ── Handler principal ──
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { type, data } = JSON.parse(event.body || '{}');

    if (type === 'welcome') {
      const { name, email, plan } = data;
      const template = welcomeEmail({ name, email, plan });

      const result = await resend.emails.send({
        from: FROM,
        reply_to: REPLY_TO,
        to: email,
        subject: template.subject,
        html: template.html,
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: result.id }) };
    }

    if (type === 'weekly') {
      const { name, email, score, streak, badges, topThreat } = data;
      const template = weeklyReportEmail({ name, email, score, streak: streak || 0, badges: badges || 0, topThreat });

      const result = await resend.emails.send({
        from: FROM,
        reply_to: REPLY_TO,
        to: email,
        subject: template.subject,
        html: template.html,
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: result.id }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Type inconnu' }) };

  } catch (err) {
    console.error('Email error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
