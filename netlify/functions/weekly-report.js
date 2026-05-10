// ════════════════════════════════════════════
// DESPY — Rapport hebdomadaire
// Cron : chaque lundi à 9h → 0 9 * * 1
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const WEEKLY_TIPS = [
  "Vérifiez les SMS suspects : aucun organisme officiel (impôts, CAF, Ameli) ne vous demande de cliquer sur un lien pour saisir vos identifiants.",
  "Activez la double authentification sur votre email — c'est la mesure la plus efficace contre le piratage.",
  "Ne partagez jamais votre mot de passe par téléphone, même si l'interlocuteur prétend être votre banque.",
  "Mettez à jour vos applications régulièrement — les mises à jour corrigent souvent des failles de sécurité.",
  "Vérifiez l'URL avant de saisir votre mot de passe : assurez-vous d'être sur le bon site (cadenas + adresse exacte)."
];

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, prenom')
      .eq('subscribed', true);

    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    const tip = WEEKLY_TIPS[new Date().getDay() % WEEKLY_TIPS.length];
    const weekNum = Math.ceil(new Date().getDate() / 7);
    let sent = 0;

    for (const client of clients) {
      const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';
      try {
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({
            type: 'custom',
            data: {
              email: client.email,
              subject: `🛡️ Votre conseil Despy de la semaine`,
              html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
                <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:28px;color:#fff;text-align:center">
                  <div style="font-size:11px;font-weight:700;opacity:.7;letter-spacing:2px">DESPY — CONSEIL HEBDOMADAIRE</div>
                  <div style="font-size:20px;font-weight:900;margin-top:8px">Semaine ${weekNum}</div>
                </div>
                <div style="padding:28px">
                  <p style="font-size:16px;color:#111">Bonjour <strong>${prenom}</strong> 👋</p>
                  <div style="background:#f0f3ff;border-left:4px solid #2D5BFF;border-radius:0 12px 12px 0;padding:18px;margin:20px 0">
                    <p style="font-weight:700;color:#2D5BFF;margin:0 0 8px;font-size:14px">💡 Conseil de la semaine</p>
                    <p style="font-size:14px;color:#333;line-height:1.7;margin:0">${tip}</p>
                  </div>
                  <div style="text-align:center;margin:24px 0">
                    <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
                      Poser une question au Conseiller →
                    </a>
                  </div>
                  <p style="font-size:11px;color:#aaa;text-align:center">Despy · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
                </div>
              </div>`
            }
          })
        });
        sent++;
      } catch (e) { console.error('Email error:', client.email, e); }
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Rapports hebdomadaires envoyés: ${sent}`);
    return { statusCode: 200, body: JSON.stringify({ sent }) };

  } catch (err) {
    console.error('Weekly report error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
