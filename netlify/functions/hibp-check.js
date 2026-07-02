// ════════════════════════════════════════════
// DESPY — Vérification HIBP + Dark Web
// Have I Been Pwned API v3
// Cron : 1er du mois à 7h → 0 7 1 * *
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const HIBP_API_KEY = process.env.HIBP_API_KEY;
const HIBP_BASE    = 'https://haveibeenpwned.com/api/v3';

// Vérifier si un email est dans une fuite HIBP
async function checkEmailBreaches(email) {
  if (!HIBP_API_KEY) {
    console.warn('HIBP_API_KEY non configurée');
    return null;
  }

  try {
    const res = await fetch(
      `${HIBP_BASE}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      {
        headers: {
          'hibp-api-key': HIBP_API_KEY,
          'user-agent': 'Despy-Protection (contact.despy@gmail.com)',
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (res.status === 404) return []; // Aucune fuite
    if (res.status === 401) { console.error('Clé HIBP invalide'); return null; }
    if (res.status === 429) { console.warn('Rate limit HIBP'); return null; }
    if (!res.ok) return null;

    const breaches = await res.json();
    return breaches;

  } catch (err) {
    console.error('HIBP error:', err.message);
    return null;
  }
}

function buildBreachAlertHTML(prenom, email, breaches, isNew) {
  const newBreaches = breaches.filter(b => isNew.includes(b.Name));
  const allCount = breaches.length;
  const newCount = newBreaches.length;

  const breachListHTML = newBreaches.slice(0, 5).map(b => `
    <div style="padding:12px;background:#fff;border-radius:10px;border:1px solid #fca5a5;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <strong style="color:#dc2626;font-size:14px">${b.Name}</strong>
        <span style="font-size:11px;color:#888">${new Date(b.BreachDate).toLocaleDateString('fr-FR', {month:'long', year:'numeric'})}</span>
      </div>
      <div style="font-size:12px;color:#555">
        ${b.DataClasses ? b.DataClasses.slice(0,4).join(' · ') : 'Données personnelles'}
      </div>
    </div>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">

      <!-- Bandeau de marque (fond identique au logo officiel) -->
      <div style="background:#010410;padding:16px 28px;text-align:center">
        <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="100" style="width:100px;max-width:42%;height:auto;display:inline-block;border:0">
      </div>

      <!-- Header alerte -->
      <div style="background:#dc2626;padding:22px 28px;color:#fff">
        <div style="font-size:11px;font-weight:700;opacity:.8;letter-spacing:2px">DESPY — ALERTE DARK WEB</div>
        <div style="font-size:22px;font-weight:900;margin-top:6px">
          ⚠️ Vos données ont été compromises
        </div>
      </div>

      <div style="padding:28px">
        <p style="font-size:16px;color:#111">Bonjour <strong>${prenom}</strong>,</p>

        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:16px;margin:16px 0">
          <p style="font-weight:700;color:#dc2626;margin:0 0 6px;font-size:15px">
            🚨 ${newCount} nouvelle${newCount > 1 ? 's' : ''} fuite${newCount > 1 ? 's' : ''} détectée${newCount > 1 ? 's' : ''}
          </p>
          <p style="font-size:13px;color:#555;margin:0">
            Votre email <strong>${email}</strong> est apparu dans ${newCount} base${newCount > 1 ? 's' : ''} de données piratée${newCount > 1 ? 's' : ''}.
            ${allCount > newCount ? `Au total, votre email est présent dans <strong>${allCount} fuites</strong> connues.` : ''}
          </p>
        </div>

        <!-- Liste des fuites -->
        <div style="margin:20px 0">
          <p style="font-weight:700;color:#111;margin-bottom:12px;font-size:14px">Fuites détectées ce mois :</p>
          ${breachListHTML}
          ${newBreaches.length > 5 ? `<p style="font-size:12px;color:#888;text-align:center">+ ${newBreaches.length - 5} autres fuites</p>` : ''}
        </div>

        <!-- Actions urgentes -->
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin:20px 0">
          <p style="font-weight:700;color:#d97706;margin:0 0 10px;font-size:14px">⚡ Actions à faire maintenant</p>
          <div style="font-size:13px;color:#555;line-height:1.8">
            1. <strong>Changez votre mot de passe</strong> sur les sites concernés<br>
            2. <strong>Ne réutilisez jamais</strong> ce mot de passe ailleurs<br>
            3. <strong>Activez la double authentification</strong> sur votre email<br>
            4. <strong>Surveillez vos relevés bancaires</strong> les prochaines semaines
          </div>
        </div>

        <!-- CTA -->
        <div style="text-align:center;margin:24px 0">
          <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
            Obtenir de l'aide — Conseiller Despy →
          </a>
        </div>

        <p style="font-size:11px;color:#aaa;text-align:center">
          Despy · Surveillance dark web · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a><br>
          Source : <a href="https://haveibeenpwned.com" style="color:#aaa">HaveIBeenPwned.com</a> de Troy Hunt
        </p>
      </div>
    </div>
  `;
}

// ── Cercle de confiance : alerte simplifiée envoyée au proche ──
// On ne transmet PAS le détail des fuites, seulement le fait qu'il
// y a un danger et comment aider — sobriété volontaire (vie privée).
async function alertTrustedContact(client, breachCount) {
  const contactEmail = client && client.trusted_contact_email;
  if (!contactEmail) return false;
  const prenom = (client.prenom || (client.name || '').split(' ')[0]) || 'votre proche';
  const contactName = client.trusted_contact_name || '';
  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify({
        type: 'custom',
        data: {
          email: contactEmail,
          subject: `⚠️ Despy — Alerte concernant ${prenom} : données trouvées dans une fuite`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
              <div style="background:#010410;padding:16px 28px;text-align:center">
                <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="100" style="width:100px;max-width:42%;height:auto;display:inline-block;border:0">
              </div>
              <div style="background:#d97706;padding:22px 28px;color:#fff">
                <div style="font-size:11px;font-weight:700;opacity:.85;letter-spacing:2px">DESPY — CERCLE DE CONFIANCE</div>
                <div style="font-size:21px;font-weight:900;margin-top:6px">⚠️ Alerte concernant ${prenom}</div>
              </div>
              <div style="padding:28px">
                <p style="font-size:15px;color:#333;line-height:1.7">Bonjour${contactName ? ' ' + contactName : ''},</p>
                <p style="font-size:14px;color:#555;line-height:1.7">Vous êtes la personne de confiance de <strong>${prenom}</strong> sur Despy. Notre surveillance vient de détecter que ses données personnelles apparaissent dans <strong>${breachCount} fuite${breachCount > 1 ? 's' : ''} de données</strong> (sites piratés).</p>
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin:18px 0">
                  <p style="font-weight:700;color:#d97706;margin:0 0 10px;font-size:14px">💛 Comment aider ${prenom}</p>
                  <div style="font-size:13px;color:#555;line-height:1.9">
                    1. <strong>Appelez-le/la</strong> pour l'informer calmement — ${prenom} a reçu le détail par email<br>
                    2. Aidez-le/la à <strong>changer ses mots de passe</strong> sur les sites concernés<br>
                    3. Rappelez-lui de <strong>ne jamais donner un code reçu par SMS</strong>, même à un « conseiller bancaire »<br>
                    4. Surveillez ensemble ses relevés bancaires ces prochaines semaines
                  </div>
                </div>
                <p style="font-size:12px;color:#888;line-height:1.6">Par respect de sa vie privée, le détail des fuites n'est envoyé qu'à ${prenom}. Cette alerte vous est adressée car ${prenom} vous a désigné comme personne de confiance dans son espace Despy.</p>
                <p style="font-size:11px;color:#aaa;text-align:center;margin-top:20px">Despy · Surveillance dark web · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
              </div>
            </div>`
        }
      })
    });
    return r.ok;
  } catch (e) {
    console.error('Alerte proche HIBP:', e.message);
    return false;
  }
}

// ── Alerte push instantanée (en plus de l'email) ──
// Prévient le membre sur son téléphone dès qu'une NOUVELLE fuite est
// détectée par la surveillance de fond. N'échoue jamais bruyamment :
// l'email reste le canal fiable, la push est un bonus de rapidité.
async function sendBreachPush(email, newCount) {
  try {
    await fetch(`${process.env.URL}/.netlify/functions/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify({
        email,
        title: '🚨 Despy — Nouvelle fuite de données',
        body: `Votre email apparaît dans ${newCount} nouvelle${newCount > 1 ? 's' : ''} fuite${newCount > 1 ? 's' : ''}. Ouvrez votre email Despy pour les détails et la marche à suivre.`,
        url: 'https://despy.fr'
      })
    });
  } catch (e) { console.error('push HIBP:', e.message); }
}

// ── Vérification MANUELLE à la demande, pour UN seul email ──
// Appelée depuis le tableau de bord (bouton « Vérifier mon email »).
// Renvoie { breachCount, emailSent } pour cet email précis.
async function handleManualCheck(supabase, rawEmail) {
  const json = (obj) => ({ statusCode: 200, body: JSON.stringify(obj) });
  const email = (rawEmail || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return json({ error: 'invalid_email', breachCount: null });

  try {
    // Récupérer le client (pour le prénom + historiser le résultat)
    const { data: client } = await supabase
      .from('clients')
      .select('email, name, prenom, known_breaches, trusted_contact_name, trusted_contact_email')
      .eq('email', email)
      .maybeSingle();

    const breaches = await checkEmailBreaches(email);
    if (breaches === null) return json({ error: 'unavailable', breachCount: null });

    const breachCount = breaches.length;
    const currentNames = breaches.map(b => b.Name);
    const prenom = (client && (client.prenom || (client.name || '').split(' ')[0])) || 'cher membre';

    // Historiser dans Supabase si le client existe
    if (client) {
      await supabase.from('clients').update({
        last_hibp_check: new Date().toISOString(),
        known_breaches: currentNames,
        breach_count: breachCount,
        updated_at: new Date().toISOString()
      }).eq('email', email);
    }

    // Email de détail : on liste TOUTES les fuites trouvées (vérif à la demande)
    let emailSent = false;
    if (breachCount > 0) {
      try {
        const html = buildBreachAlertHTML(prenom, email, breaches, currentNames);
        const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({
            type: 'custom',
            data: {
              email,
              subject: `🚨 Despy — Votre email dans ${breachCount} fuite${breachCount > 1 ? 's' : ''} de données`,
              html
            }
          })
        });
        emailSent = r.ok;
      } catch (e) { console.error('send-email manuel HIBP:', e.message); }

      // Cercle de confiance : alerter le proche désigné
      if (client) await alertTrustedContact(client, breachCount);
    }

    return json({ breachCount, emailSent });
  } catch (e) {
    console.error('HIBP manuel error:', e.message);
    return json({ error: 'server', breachCount: null });
  }
}

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Appel manuel (POST avec un email) → on ne vérifie QUE cet email.
  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    if (body.email) {
      const { requireAuth } = require('./_auth');
      const auth = requireAuth(event, body, body.email, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      if (!auth.ok) return auth.response;
      return await handleManualCheck(supabase, body.email);
    }
  }

  try {
    // Récupérer les abonnés actifs
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, prenom, last_hibp_check, known_breaches, trusted_contact_name, trusted_contact_email')
      .eq('subscribed', true);

    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ checked: 0, alerts: 0 }) };
    }

    let checked = 0;
    let alerts = 0;

    for (const client of clients) {
      const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';

      try {
        // Vérifier HIBP
        const breaches = await checkEmailBreaches(client.email);
        if (breaches === null) continue; // Erreur API, on passe

        // Trouver les nouvelles fuites depuis la dernière vérification
        const knownBreaches = client.known_breaches || [];
        const currentBreachNames = breaches.map(b => b.Name);
        const newBreaches = currentBreachNames.filter(n => !knownBreaches.includes(n));

        // Mettre à jour Supabase
        await supabase.from('clients').update({
          last_hibp_check: new Date().toISOString(),
          known_breaches: currentBreachNames,
          breach_count: breaches.length,
          updated_at: new Date().toISOString()
        }).eq('email', client.email);

        checked++;

        // Envoyer alerte si nouvelles fuites
        if (newBreaches.length > 0) {
          const html = buildBreachAlertHTML(prenom, client.email, breaches, newBreaches);

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
                subject: `🚨 Despy — Vos données trouvées dans ${newBreaches.length} fuite${newBreaches.length > 1 ? 's' : ''}`,
                html
              }
            })
          });

          alerts++;
          console.log(`Alerte HIBP envoyée: ${client.email} — ${newBreaches.length} nouvelles fuites`);

          // Alerte push instantanée sur le téléphone (en plus de l'email)
          await sendBreachPush(client.email, newBreaches.length);

          // Cercle de confiance : alerter le proche désigné
          await alertTrustedContact(client, newBreaches.length);
        }

        // Pause entre chaque requête HIBP (rate limit = 1 req/1.5s)
        await new Promise(r => setTimeout(r, 1600));

      } catch(e) {
        console.error(`HIBP error for ${client.email}:`, e);
      }
    }

    console.log(`HIBP check: ${checked} vérifiés, ${alerts} alertes`);
    return {
      statusCode: 200,
      body: JSON.stringify({ checked, alerts })
    };

  } catch (err) {
    console.error('HIBP handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
