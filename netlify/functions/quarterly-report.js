// ════════════════════════════════════════════
// DESPY — Bilan de sécurité trimestriel
// Cron : 1er jan, avr, juil, oct à 10h
// → 0 10 1 1,4,7,10 *
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// Checklist personnalisée selon le profil
const SECURITY_CHECKLIST = [
  {
    id: 'passwords',
    title: 'Mots de passe',
    icon: '🔐',
    checks: [
      'Vérifiez que vos mots de passe email et banque sont uniques (pas utilisés ailleurs)',
      'Activez la vérification en 2 étapes sur votre email (Gmail, Orange, Free...)',
      'Changez tout mot de passe que vous utilisez depuis plus de 12 mois sur des sites importants'
    ]
  },
  {
    id: 'updates',
    title: 'Mises à jour',
    icon: '📱',
    checks: [
      'Vérifiez les mises à jour en attente sur votre téléphone (Réglages → Général → Mise à jour)',
      'Mettez à jour vos applications — surtout WhatsApp, votre banque, et votre navigateur',
      'Vérifiez les mises à jour de votre ordinateur (Windows Update ou macOS Software Update)'
    ]
  },
  {
    id: 'accounts',
    title: 'Comptes et accès',
    icon: '👤',
    checks: [
      'Vérifiez les appareils connectés à votre compte email (Paramètres → Sécurité → Appareils)',
      'Supprimez les applications que vous n\'utilisez plus — moins d\'applications = moins de risques',
      'Vérifiez les autorisations de vos applications (localisation, micro, photos)'
    ]
  },
  {
    id: 'social',
    title: 'Réseaux sociaux',
    icon: '📘',
    checks: [
      'Vérifiez qui peut voir vos publications Facebook (Paramètres → Confidentialité)',
      'Ne partagez jamais votre adresse, numéro de téléphone ou routines publiquement',
      'Vérifiez les applications connectées à votre Facebook (Paramètres → Applications)'
    ]
  },
  {
    id: 'backup',
    title: 'Sauvegarde',
    icon: '☁️',
    checks: [
      'Vérifiez que vos photos sont sauvegardées (iCloud, Google Photos ou disque dur externe)',
      'Notez vos mots de passe importants dans un carnet physique conservé en lieu sûr',
      'Assurez-vous d\'avoir les numéros d\'urgence de votre banque notés quelque part'
    ]
  }
];

function buildQuarterlyHTML(prenom, email, quarter, year) {
  const quarterName = {1:'1er trimestre', 2:'2ème trimestre', 3:'3ème trimestre', 4:'4ème trimestre'}[quarter];

  const checklistHTML = SECURITY_CHECKLIST.map(section => `
    <div style="margin-bottom:20px;padding:16px;background:#f8faff;border-radius:12px;border-left:4px solid #2D5BFF">
      <div style="font-weight:700;color:#111;margin-bottom:10px;font-size:15px">${section.icon} ${section.title}</div>
      ${section.checks.map(check => `
        <div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start">
          <span style="color:#2D5BFF;font-size:16px;flex-shrink:0;margin-top:1px">☐</span>
          <span style="font-size:13px;color:#555;line-height:1.5">${check}</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:32px 28px;color:#fff">
        <div style="display:flex;align-items:center;gap:14px">
          <span style="font-size:40px">🛡️</span>
          <div>
            <div style="font-size:12px;font-weight:700;opacity:.7;letter-spacing:2px">DESPY — BILAN TRIMESTRIEL</div>
            <div style="font-size:22px;font-weight:900">${quarterName} ${year}</div>
          </div>
        </div>
      </div>

      <div style="padding:28px">
        <p style="font-size:16px;color:#111;margin:0 0 6px">Bonjour <strong>${prenom}</strong> 👋</p>
        <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 20px">
          Chaque trimestre, Despy vous envoie votre <strong>checklist de sécurité personnalisée</strong>. 
          Prenez 10 minutes pour parcourir ces points — c'est votre "révision technique" du trimestre.
        </p>

        <!-- Score de motivation -->
        <div style="background:linear-gradient(135deg,#f0f3ff,#e8eeff);border:1px solid #c7d2fe;border-radius:12px;padding:16px;margin-bottom:24px;text-align:center">
          <div style="font-size:13px;color:#4f46e5;font-weight:600;margin-bottom:4px">🎯 Objectif du trimestre</div>
          <div style="font-size:15px;color:#111">Cocher les 15 points de cette liste = <strong>+50 XP Despy</strong></div>
        </div>

        <!-- Checklist -->
        <div style="font-weight:700;font-size:16px;color:#111;margin-bottom:14px">Votre checklist de sécurité :</div>
        ${checklistHTML}

        <!-- Menace du trimestre -->
        <div style="border-left:4px solid #ef4444;padding:14px 16px;background:#fef2f2;border-radius:0 10px 10px 0;margin:24px 0">
          <p style="font-weight:700;color:#dc2626;margin:0 0 6px;font-size:14px">⚠️ Arnaque phare de ce trimestre</p>
          <p style="font-size:13px;color:#555;margin:0;line-height:1.6">
            Les appels de faux conseillers bancaires sont en forte hausse. Ils connaissent votre nom, 
            votre banque, et créent une urgence. <strong>Aucune banque ne vous demandera jamais votre 
            code SMS par téléphone.</strong> Raccrochez et rappelez le numéro au dos de votre carte.
          </p>
        </div>

        <!-- CTA -->
        <div style="text-align:center;margin:24px 0">
          <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
            Poser une question au Conseiller Despy →
          </a>
        </div>

        <p style="font-size:11px;color:#aaa;text-align:center;line-height:1.6">
          Despy · Protection numérique pour particuliers<br>
          <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a> · 
          <a href="mailto:contact.despy@gmail.com" style="color:#aaa">contact.despy@gmail.com</a>
        </p>
      </div>
    </div>
  `;
}

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

    const now = new Date();
    const month = now.getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    const year = now.getFullYear();

    let sent = 0;
    for (const client of clients) {
      const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';
      try {
        const html = buildQuarterlyHTML(prenom, client.email, quarter, year);
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'custom',
            data: {
              email: client.email,
              subject: `🛡️ Votre bilan Despy — ${quarter === 1 ? '1er' : quarter + 'ème'} trimestre ${year}`,
              html
            }
          })
        });
        sent++;
      } catch(e) { console.error('Email error:', client.email, e); }
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`Bilans trimestriels envoyés: ${sent}`);
    return { statusCode: 200, body: JSON.stringify({ sent, quarter, year }) };

  } catch (err) {
    console.error('Quarterly report error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
