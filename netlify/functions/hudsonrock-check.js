// ════════════════════════════════════════════
// DESPY — Surveillance « appareil infecté » (infostealer)
// Source : Hudson Rock — Cavalier (endpoint OSINT gratuit, sans clé API)
// Cron : le 15 du mois à 7h → 0 7 15 * *  (complète HIBP qui tourne le 1er)
//
// Pour chaque abonné, on vérifie si un de ses appareils apparaît dans
// les logs d'infostealer. Dès qu'une NOUVELLE infection est détectée :
//   → email d'alerte au client (avec les bons réflexes)
//   → alerte sobre au proche désigné (cercle de confiance)
//
// Vie privée : on ne stocke et n'envoie JAMAIS les mots de passe /
// identifiants exposés. Uniquement date + système d'exploitation.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const HR_BASE = 'https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email';

// Récupère les infections (infostealers) pour un email. null = service indispo.
async function checkEmailStealers(email) {
  try {
    const res = await fetch(`${HR_BASE}?email=${encodeURIComponent(email)}`, {
      headers: { 'User-Agent': 'Despy-Protection (contact@despy.fr)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.stealers) ? data.stealers : [];
  } catch (e) {
    console.error('Hudson Rock error:', e.message);
    return null;
  }
}

// Clé stable pour repérer une infection déjà connue d'une nouvelle.
function stealerKey(s) {
  return [(s.date_compromised || ''), (s.computer_name || ''), (s.malware_path || '')].join('|');
}

function frMonth(d) {
  try { return d ? new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : ''; }
  catch (e) { return ''; }
}

// Email d'alerte client — sérieux mais rassurant, avec marche à suivre.
function buildStealerAlertHTML(prenom, email, stealers, newKeys) {
  const newOnes = stealers.filter(s => newKeys.includes(stealerKey(s)));
  const count = newOnes.length;

  const listHTML = newOnes.slice(0, 5).map(s => {
    const os = (s.operating_system && s.operating_system !== 'Not Found') ? s.operating_system : 'Appareil';
    const date = frMonth(s.date_compromised);
    return `
      <div style="padding:12px;background:#fff;border-radius:10px;border:1px solid #fca5a5;margin-bottom:8px">
        <strong style="color:#dc2626;font-size:14px">🖥️ ${os}</strong>
        ${date ? `<span style="font-size:12px;color:#888;margin-left:8px">infecté en ${date}</span>` : ''}
      </div>`;
  }).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">

      <div style="background:#010410;padding:16px 28px;text-align:center">
        <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="100" style="width:100px;max-width:42%;height:auto;display:inline-block;border:0">
      </div>
      <div style="background:#dc2626;padding:22px 28px;color:#fff">
        <div style="font-size:11px;font-weight:700;opacity:.8;letter-spacing:2px">DESPY — ALERTE APPAREIL INFECTÉ</div>
        <div style="font-size:22px;font-weight:900;margin-top:6px">🦠 Un de vos appareils a été infecté</div>
      </div>

      <div style="padding:28px">
        <p style="font-size:16px;color:#111">Bonjour <strong>${prenom}</strong>,</p>

        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:16px;margin:16px 0">
          <p style="font-weight:700;color:#dc2626;margin:0 0 6px;font-size:15px">
            🚨 ${count} appareil${count > 1 ? 's' : ''} infecté${count > 1 ? 's' : ''} détecté${count > 1 ? 's' : ''}
          </p>
          <p style="font-size:13px;color:#555;margin:0">
            Un <strong>virus voleur de mots de passe</strong> (« infostealer ») a été repéré sur un appareil lié à votre email <strong>${email}</strong>.
            C'est <strong>plus grave qu'une simple fuite</strong> : tous les mots de passe enregistrés sur cet appareil (sites, banque, messagerie) peuvent être entre les mains de pirates.
          </p>
        </div>

        <div style="margin:20px 0">
          <p style="font-weight:700;color:#111;margin-bottom:12px;font-size:14px">Appareil(s) concerné(s) :</p>
          ${listHTML}
        </div>

        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin:20px 0">
          <p style="font-weight:700;color:#d97706;margin:0 0 10px;font-size:14px">⚡ À faire maintenant — dans l'ordre</p>
          <div style="font-size:13px;color:#555;line-height:1.9">
            1. <strong>Lancez un antivirus</strong> sur l'appareil concerné pour retirer le virus.<br>
            2. Depuis un <strong>autre appareil sain</strong>, <strong>changez vos mots de passe</strong> importants (email, banque).<br>
            3. <strong>Ne réutilisez jamais</strong> un même mot de passe sur plusieurs sites.<br>
            4. <strong>Activez la double authentification</strong> sur votre email et votre banque.<br>
            5. <strong>Surveillez vos relevés bancaires</strong> les prochaines semaines.
          </div>
        </div>

        <div style="text-align:center;margin:24px 0">
          <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
            Être guidé pas à pas — Conseiller Despy →
          </a>
        </div>

        <p style="font-size:11px;color:#aaa;text-align:center">
          Despy · Surveillance des appareils infectés · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a><br>
          Source : Hudson Rock · Cavalier
        </p>
      </div>
    </div>
  `;
}

// Alerte sobre au proche désigné (sans détail technique — vie privée).
async function alertTrustedContact(client, count) {
  const contactEmail = client && client.trusted_contact_email;
  if (!contactEmail) return false;
  const prenom = (client.prenom || (client.name || '').split(' ')[0]) || 'votre proche';
  const contactName = client.trusted_contact_name || '';
  try {
    const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({
        type: 'custom',
        data: {
          email: contactEmail,
          subject: `⚠️ Despy — Alerte concernant ${prenom} : un appareil infecté détecté`,
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
                <p style="font-size:14px;color:#555;line-height:1.7">Vous êtes la personne de confiance de <strong>${prenom}</strong> sur Despy. Notre surveillance vient de détecter qu'un de ses appareils a été <strong>infecté par un virus voleur de mots de passe</strong>. C'est sérieux : ses mots de passe enregistrés peuvent être compromis.</p>
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin:18px 0">
                  <p style="font-weight:700;color:#d97706;margin:0 0 10px;font-size:14px">💛 Comment aider ${prenom}</p>
                  <div style="font-size:13px;color:#555;line-height:1.9">
                    1. <strong>Appelez-le/la</strong> calmement — ${prenom} a reçu le détail et la marche à suivre par email.<br>
                    2. Aidez-le/la à <strong>lancer un antivirus</strong> puis à <strong>changer ses mots de passe</strong> depuis un autre appareil.<br>
                    3. Rappelez-lui de <strong>ne jamais donner un code reçu par SMS</strong>, même à un « conseiller bancaire ».<br>
                    4. Surveillez ensemble ses relevés bancaires ces prochaines semaines.
                  </div>
                </div>
                <p style="font-size:12px;color:#888;line-height:1.6">Par respect de sa vie privée, le détail technique n'est envoyé qu'à ${prenom}. Vous recevez cette alerte car ${prenom} vous a désigné comme personne de confiance dans son espace Despy.</p>
                <p style="font-size:11px;color:#aaa;text-align:center;margin-top:20px">Despy · Surveillance des appareils infectés · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
              </div>
            </div>`
        }
      })
    });
    return r.ok;
  } catch (e) {
    console.error('Alerte proche infostealer:', e.message);
    return false;
  }
}

// ── Alerte push instantanée (en plus de l'email) ──
// Prévient le membre sur son téléphone dès qu'une NOUVELLE infection est
// détectée. Échec silencieux : l'email reste le canal fiable.
async function sendStealerPush(email, newCount) {
  try {
    await fetch(`${process.env.URL}/.netlify/functions/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify({
        email,
        title: '🦠 Despy — Appareil infecté détecté',
        body: `Un virus voleur de mots de passe a été repéré sur ${newCount > 1 ? newCount + ' de vos appareils' : 'un de vos appareils'}. Ouvrez votre email Despy pour la marche à suivre.`,
        url: 'https://despy.fr'
      })
    });
  } catch (e) { console.error('push infostealer:', e.message); }
}

// ── Vérification MANUELLE à la demande pour UN email (authentifiée) ──
async function handleManualCheck(supabase, rawEmail) {
  const json = (obj) => ({ statusCode: 200, body: JSON.stringify(obj) });
  const email = (rawEmail || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return json({ error: 'invalid_email', infected: null });

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('email, name, prenom, known_stealers, trusted_contact_name, trusted_contact_email')
      .eq('email', email)
      .maybeSingle();

    const stealers = await checkEmailStealers(email);
    if (stealers === null) return json({ error: 'unavailable', infected: null });

    const count = stealers.length;
    const currentKeys = stealers.map(stealerKey);
    const prenom = (client && (client.prenom || (client.name || '').split(' ')[0])) || 'cher membre';

    if (client) {
      await supabase.from('clients').update({
        last_stealer_check: new Date().toISOString(),
        known_stealers: currentKeys,
        stealer_count: count,
        updated_at: new Date().toISOString()
      }).eq('email', email);
    }

    let emailSent = false;
    if (count > 0) {
      try {
        const html = buildStealerAlertHTML(prenom, email, stealers, currentKeys);
        const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
          body: JSON.stringify({
            type: 'custom',
            data: {
              email,
              subject: `🦠 Despy — Un de vos appareils a été infecté (${count} détecté${count > 1 ? 's' : ''})`,
              html
            }
          })
        });
        emailSent = r.ok;
      } catch (e) { console.error('send-email manuel infostealer:', e.message); }

      if (client) await alertTrustedContact(client, count);
    }

    return json({ infected: count > 0, count, emailSent });
  } catch (e) {
    console.error('Infostealer manuel error:', e.message);
    return json({ error: 'server', infected: null });
  }
}

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Appel manuel authentifié (POST avec un email) → on ne vérifie QUE cet email.
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

  // ── Cron mensuel : tous les abonnés ──
  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('email, name, prenom, last_stealer_check, known_stealers, trusted_contact_name, trusted_contact_email')
      .eq('subscribed', true);

    if (error) {
      // Le plus souvent : colonnes manquantes → lancer la migration SQL.
      console.error('Infostealer cron — select error (migration SQL manquante ?):', error.message);
      return { statusCode: 200, body: JSON.stringify({ checked: 0, alerts: 0, error: 'select' }) };
    }
    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ checked: 0, alerts: 0 }) };
    }

    let checked = 0;
    let alerts = 0;

    for (const client of clients) {
      const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';
      try {
        const stealers = await checkEmailStealers(client.email);
        if (stealers === null) continue; // service indispo, on passe

        const known = client.known_stealers || [];
        const currentKeys = stealers.map(stealerKey);
        const newKeys = currentKeys.filter(k => !known.includes(k));

        await supabase.from('clients').update({
          last_stealer_check: new Date().toISOString(),
          known_stealers: currentKeys,
          stealer_count: stealers.length,
          updated_at: new Date().toISOString()
        }).eq('email', client.email);

        checked++;

        if (newKeys.length > 0) {
          const html = buildStealerAlertHTML(prenom, client.email, stealers, newKeys);
          await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
            body: JSON.stringify({
              type: 'custom',
              data: {
                email: client.email,
                subject: `🦠 Despy — Un de vos appareils a été infecté`,
                html
              }
            })
          });
          alerts++;
          console.log(`Alerte infostealer envoyée: ${client.email} — ${newKeys.length} nouvelle(s) infection(s)`);

          // Alerte push instantanée sur le téléphone (en plus de l'email)
          await sendStealerPush(client.email, newKeys.length);

          await alertTrustedContact(client, newKeys.length);
        }

        // Pause entre chaque requête (prudence rate limit)
        await new Promise(r => setTimeout(r, 1600));
      } catch (e) {
        console.error(`Infostealer error for ${client.email}:`, e.message);
      }
    }

    console.log(`Infostealer check: ${checked} vérifiés, ${alerts} alertes`);
    return { statusCode: 200, body: JSON.stringify({ checked, alerts }) };
  } catch (err) {
    console.error('Infostealer handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
