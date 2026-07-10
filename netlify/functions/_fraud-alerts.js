// ════════════════════════════════════════════
// DESPY — Alerte Secteur : dispatch des alertes temps réel (module partagé)
// Appelé quand un signalement est APPROUVÉ (auto ou via fraud-moderate).
//
// Cible : les abonnés aux alertes (fraud_alert_subs) du MÊME DÉPARTEMENT,
// qui sont clients premium (clients.subscribed = true).
//   → notification push immédiate (send-push, ciblée par email)
//   → email premium sobre
// Les inscrits gratuits, eux, reçoivent le récap hebdo de LEUR commune
// (fraud-digest.js) — c'est la frontière gratuit/payant.
// ════════════════════════════════════════════

const CATEGORIES = {
  faux_artisan: 'Faux artisan / dépanneur',
  faux_agent: 'Faux agent (EDF, eau, police…)',
  demarchage_abusif: 'Démarchage abusif à domicile',
  arnaque_telephone: 'Arnaque par téléphone locale',
  faux_livreur: 'Faux livreur / faux colis',
  vol_ruse: 'Vol par ruse',
  autre: 'Autre arnaque locale'
};

function alertEmailHTML(prenom, report) {
  const label = CATEGORIES[report.category] || 'Arnaque locale';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
    <div style="background:#010410;padding:16px 28px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="100" style="color:#fff;font-size:22px;font-weight:900;width:100px;max-width:42%;height:auto;display:inline-block;border:0">
    </div>
    <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);padding:22px 28px;color:#fff">
      <div style="font-size:11px;font-weight:700;opacity:.85;letter-spacing:2px">DESPY — ALERTE DANS VOTRE SECTEUR</div>
      <div style="font-size:21px;font-weight:900;margin-top:6px">⚠️ ${label} signalé à ${report.ville}</div>
    </div>
    <div style="padding:26px 28px">
      <p style="font-size:15px;color:#333;line-height:1.7">Bonjour${prenom ? ' ' + prenom : ''},</p>
      <p style="font-size:14.5px;color:#555;line-height:1.7">Un membre Despy de votre département vient de signaler une arnaque en cours près de chez vous :</p>
      <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 12px 12px 0;padding:14px 18px;margin:14px 0;font-size:14.5px;color:#333;line-height:1.7">
        📍 <strong>${report.ville} (${report.code_postal})</strong><br>${report.description || label}
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px 16px;margin:0 0 18px">
        <div style="font-size:13.5px;color:#166534;line-height:1.7">🛡️ <strong>Les bons réflexes :</strong> ne laissez jamais entrer un inconnu sans rendez-vous, demandez une carte professionnelle, et appelez l'organisme officiel (numéro trouvé par vous-même) avant d'ouvrir. En cas de doute : bouton SOS Despy.</div>
      </div>
      <div style="text-align:center;margin:18px 0 6px">
        <a href="https://despy.fr/carte-arnaques" style="display:inline-block;background:#2D5BFF;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Voir la carte de mon secteur</a>
      </div>
      <p style="font-size:11px;color:#aaa;text-align:center;margin-top:18px">Alerte réservée aux membres Premium · Despy · despy.fr</p>
    </div>
  </div>`;
}

// Envoie push + email aux premium du département du signalement.
async function dispatchFraudAlert(supabase, report) {
  const dept = String(report.code_postal || '').slice(0, 2);
  if (dept.length !== 2) return { alerted: 0 };

  // Abonnés aux alertes dans ce département
  const { data: subs } = await supabase
    .from('fraud_alert_subs')
    .select('email, ville, code_postal')
    .like('code_postal', dept + '%');
  if (!subs || subs.length === 0) return { alerted: 0 };

  // Parmi eux, les clients premium (temps réel = payant)
  const emails = subs.map(s => s.email);
  const { data: premiums } = await supabase
    .from('clients')
    .select('email, prenom, name')
    .in('email', emails)
    .eq('subscribed', true);
  if (!premiums || premiums.length === 0) return { alerted: 0 };

  const label = CATEGORIES[report.category] || 'Arnaque locale';
  let alerted = 0;

  for (const p of premiums) {
    // Ne pas alerter le signaleur lui-même
    if ((p.email || '').toLowerCase() === (report.reporter_email || '').toLowerCase()) continue;
    const prenom = p.prenom || (p.name || '').split(' ')[0] || '';

    // Push immédiate (best-effort)
    try {
      await fetch(`${process.env.URL}/.netlify/functions/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
        body: JSON.stringify({
          email: p.email,
          title: `⚠️ ${label} — ${report.ville}`,
          body: `Signalé à l'instant dans votre secteur. Ouvrez Despy pour les détails et les bons réflexes.`,
          url: 'https://despy.fr/carte-arnaques'
        })
      });
    } catch (e) { console.warn('push alerte secteur:', e.message); }

    // Email
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Despy — Alerte Secteur <contact@despy.fr>',
          to: [p.email],
          subject: `⚠️ ${label} signalé à ${report.ville} — soyez vigilant`,
          html: alertEmailHTML(prenom, report)
        })
      });
      alerted++;
    } catch (e) { console.warn('email alerte secteur:', e.message); }

    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`Alerte secteur ${report.ville}: ${alerted} premium alertés (dept ${dept})`);
  return { alerted };
}

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé, pas un endpoint
module.exports = { CATEGORIES, dispatchFraudAlert, handler };
