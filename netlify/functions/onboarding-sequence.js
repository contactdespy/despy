// ════════════════════════════════════════════
// DESPY — Séquence email onboarding automatique
// Cron : tous les jours à 11h → 0 11 * * *
// J+1 : premier contact si pas encore posé de question
// J+7 : urgence si 1-2 questions utilisées
// J+14 : dernière chance avec offre spéciale
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

async function sendEmail(type, data) {
  await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_SECRET || ''
    },
    body: JSON.stringify({ type, data })
  });
}

exports.handler = async (event) => {
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();   // cron uniquement (pas d'appel HTTP)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const now = new Date();

  // Fenêtre de ±12h autour du jour cible pour éviter les doublons
  function dayRange(daysAgo) {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end   = new Date(d); end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  let sent = { j1: 0, j7: 0, j14: 0 };

  try {
    // ── J+1 : n'a pas encore posé de question ──
    const r1 = dayRange(1);
    const { data: leads_j1 } = await supabase
      .from('clients')
      .select('email, prenom, name')
      .eq('subscribed', false)
      .eq('questions_used', 0)
      .gte('created_at', r1.start)
      .lte('created_at', r1.end);

    for (const l of leads_j1 || []) {
      const prenom = l.prenom || l.name?.split(' ')[0] || 'cher membre';
      try {
        await sendEmail('custom', {
          email: l.email,
          subject: 'Despy — Avez-vous posé votre première question ?',
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
            <h2 style="color:#2D5BFF">Bonjour ${prenom} 👋</h2>
            <p>Vous avez créé votre compte Despy hier — super ! Avez-vous essayé le Conseiller Despy ?</p>
            <p>Vous avez <strong>3 questions gratuites</strong> pour tester. Posez celle qui vous préoccupe en ce moment :</p>
            <ul style="color:#555;line-height:2">
              <li>Reconnaître une arnaque SMS ou email</li>
              <li>Savoir si votre email a été piraté</li>
              <li>Sécuriser votre compte Facebook ou email</li>
            </ul>
            <div style="text-align:center;margin:28px 0">
              <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                Poser ma première question →
              </a>
            </div>
            <p style="font-size:12px;color:#aaa;text-align:center">Despy · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
          </div>`
        });
        sent.j1++;
      } catch(e) { console.error('J+1 email error:', l.email, e); }
      await new Promise(r => setTimeout(r, 200));
    }

    // ── J+7 : a posé 1 ou 2 questions, pas encore abonné ──
    const r7 = dayRange(7);
    const { data: leads_j7 } = await supabase
      .from('clients')
      .select('email, prenom, name, questions_used')
      .eq('subscribed', false)
      .gte('questions_used', 1)
      .lte('questions_used', 2)
      .gte('created_at', r7.start)
      .lte('created_at', r7.end);

    for (const l of leads_j7 || []) {
      const prenom = l.prenom || l.name?.split(' ')[0] || 'cher membre';
      const restantes = 3 - (l.questions_used || 0);
      try {
        await sendEmail('custom', {
          email: l.email,
          subject: `Despy — Il vous reste ${restantes} question${restantes > 1 ? 's' : ''} gratuite${restantes > 1 ? 's' : ''}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
            <h2 style="color:#2D5BFF">Bonjour ${prenom},</h2>
            <p>Vous avez déjà utilisé ${l.questions_used} question${l.questions_used > 1 ? 's' : ''} sur 3. Il vous en reste <strong>${restantes}</strong> avant que votre accès gratuit expire.</p>
            <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:0 10px 10px 0;margin:20px 0">
              <strong>Pour ne pas être bloqué :</strong> passez à l'abonnement maintenant et ne perdez plus jamais accès au Conseiller Despy.
            </div>
            <p style="font-size:15px"><strong>9,99€/mois</strong> — ou <strong>89€/an</strong> (2 mois offerts)</p>
            <div style="text-align:center;margin:28px 0">
              <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                M'abonner maintenant →
              </a>
            </div>
            <p style="font-size:12px;color:#aaa;text-align:center">Despy · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
          </div>`
        });
        sent.j7++;
      } catch(e) { console.error('J+7 email error:', l.email, e); }
      await new Promise(r => setTimeout(r, 200));
    }

    // ── J+14 : dernière chance, offre annuelle mise en avant ──
    const r14 = dayRange(14);
    const { data: leads_j14 } = await supabase
      .from('clients')
      .select('email, prenom, name')
      .eq('subscribed', false)
      .gte('created_at', r14.start)
      .lte('created_at', r14.end);

    for (const l of leads_j14 || []) {
      const prenom = l.prenom || l.name?.split(' ')[0] || 'cher membre';
      try {
        await sendEmail('custom', {
          email: l.email,
          subject: 'Despy — Dernière chance : 2 mois offerts',
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
            <h2 style="color:#2D5BFF">Bonjour ${prenom},</h2>
            <p>Vous avez créé votre compte Despy il y a 2 semaines. On sait que la vie numérique peut sembler complexe — c'est justement pour ça qu'on est là.</p>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:20px 0;text-align:center">
              <div style="font-size:24px;font-weight:900;color:#16a34a">89€/an</div>
              <div style="color:#555;margin-top:4px">soit <strong>7,42€/mois</strong> — 2 mois offerts vs le mensuel</div>
            </div>
            <p>Avec Despy, vous avez :</p>
            <ul style="color:#555;line-height:2">
              <li>✅ Questions illimitées au Conseiller IA</li>
              <li>✅ Surveillance dark web chaque mois</li>
              <li>✅ Alertes cybermenaces en temps réel</li>
              <li>✅ Rapport de sécurité mensuel personnalisé</li>
            </ul>
            <div style="text-align:center;margin:28px 0">
              <a href="https://despy.fr" style="background:#16a34a;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                Profiter de l'offre annuelle →
              </a>
            </div>
            <p style="font-size:12px;color:#aaa;text-align:center">Despy · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
          </div>`
        });
        sent.j14++;
      } catch(e) { console.error('J+14 email error:', l.email, e); }
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Onboarding: J+1=${sent.j1}, J+7=${sent.j7}, J+14=${sent.j14}`);
    return { statusCode: 200, body: JSON.stringify(sent) };

  } catch (err) {
    console.error('Onboarding sequence error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
