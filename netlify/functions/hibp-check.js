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

// Vérifier les mots de passe compromis via k-anonymity (sans envoyer le mot de passe)
async function checkPasswordPwned(passwordHash) {
  try {
    const prefix = passwordHash.substring(0, 5).toUpperCase();
    const suffix = passwordHash.substring(5).toUpperCase();

    const res = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) return 0;
    const text = await res.text();
    const lines = text.split('\n');
    const match = lines.find(l => l.startsWith(suffix));
    return match ? parseInt(match.split(':')[1]) : 0;

  } catch (err) {
    return 0;
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

      <!-- Header alerte -->
      <div style="background:#dc2626;padding:24px 28px;color:#fff">
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

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Permettre aussi les appels manuels
  const isManual = event.httpMethod === 'POST';

  try {
    // Récupérer les abonnés actifs
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, prenom, last_hibp_check, known_breaches')
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
            headers: { 'Content-Type': 'application/json' },
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
