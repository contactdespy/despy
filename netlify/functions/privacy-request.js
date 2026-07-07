// ════════════════════════════════════════════════════════
// DESPY — Privacy Cleanup : enregistrement d'une demande
// MVP V1 : insert Supabase + email notification à Yacine
// ════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

// Helper : envoi email via Resend
async function sendResend(to, subject, html) {
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
      html
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend failed: ${err}`);
  }
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      user_email,
      prenom,
      nom,
      target_email,
      phone,
      ville,
      activated_at
    } = body;

    // Validation basique
    if (!user_email || !user_email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email utilisateur invalide' }) };
    }

    const auth = requireAuth(event, body, user_email, headers);
    if (!auth.ok) return auth.response;
    if (!prenom || !nom || !target_email || !phone || !ville) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Champs requis manquants' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Insert dans la table privacy_requests (créée si pas encore en BDD = error mais on continue)
    const insertPayload = {
      user_email: user_email.toLowerCase().trim(),
      prenom: prenom.trim(),
      nom: nom.trim(),
      target_email: target_email.toLowerCase().trim(),
      phone: phone.trim(),
      ville: ville.trim(),
      status: 'pending',
      activated_at: activated_at || new Date().toISOString()
    };

    try {
      await supabase.from('privacy_requests').insert(insertPayload);
    } catch (e) {
      // Si la table n'existe pas encore, on continue quand même pour envoyer l'email
      console.warn('Supabase insert failed (table may not exist yet):', e.message);
    }

    // ── Envoi AUTOMATIQUE des demandes RGPD (privacy-dispatch.js) ──
    // Le dispatch envoie : les demandes art. 17 aux brokers, le récap au client
    // (« vos demandes sont parties ») et le récap équipe (formulaires restants).
    // S'il réussit, plus rien à faire ici. S'il échoue, on retombe sur
    // l'ancienne notification manuelle ci-dessous pour ne rien perdre.
    try {
      const d = await fetch(`${process.env.URL}/.netlify/functions/privacy-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
        body: JSON.stringify({
          user_email: insertPayload.user_email,
          prenom: insertPayload.prenom,
          nom: insertPayload.nom,
          target_email: insertPayload.target_email,
          phone: insertPayload.phone,
          ville: insertPayload.ville,
          activated_at: insertPayload.activated_at
        })
      });
      if (d.ok) {
        const result = await d.json();
        console.log(`Privacy dispatch OK: ${result.sent} envoyés`);

        // Agent de scan d'empreinte (fonction background : répond 202 aussitôt
        // et travaille jusqu'à 15 min ; inactif proprement tant que la clé
        // BRAVE_SEARCH_KEY n'est pas configurée)
        try {
          await fetch(`${process.env.URL}/.netlify/functions/privacy-scan-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
            body: JSON.stringify({
              user_email: insertPayload.user_email,
              prenom: insertPayload.prenom,
              nom: insertPayload.nom,
              target_email: insertPayload.target_email,
              phone: insertPayload.phone,
              ville: insertPayload.ville
            })
          });
        } catch (e) { console.warn('scan non lancé:', e.message); }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'Demandes de suppression envoyées.', dispatched: result.sent })
        };
      }
      console.error('Dispatch non-ok:', d.status);
    } catch (e) {
      console.error('Dispatch failed, fallback notification manuelle:', e.message);
    }

    // Envoi email de notification à Yacine (repli si le dispatch a échoué)
    const adminEmail = "contact.despy@gmail.com";
    const subject = `🕵️ Nouvelle demande Privacy Cleanup — ${prenom} ${nom}`;
    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#f9fafb">
  <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);color:#fff;padding:24px;border-radius:12px 12px 0 0">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#5ee4ff;font-weight:800;margin-bottom:6px">Privacy Cleanup</div>
    <div style="font-size:22px;font-weight:900">Nouvelle demande d'audit</div>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
    <p style="margin:0 0 18px;color:#374151;line-height:1.6">Un client vient d'activer Privacy Cleanup. Voici ses informations à protéger :</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:140px">Client (compte Despy)</td><td style="padding:8px 0;font-weight:700">${user_email}</td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Prénom Nom</td><td style="padding:8px 0;font-weight:700">${prenom} ${nom}</td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Email à protéger</td><td style="padding:8px 0;font-weight:700">${target_email}</td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Téléphone</td><td style="padding:8px 0;font-weight:700">${phone}</td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Ville</td><td style="padding:8px 0;font-weight:700">${ville}</td></tr>
    </table>

    <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px;margin-bottom:18px">
      <div style="font-weight:700;color:#78350f;margin-bottom:6px">📋 Actions à faire</div>
      <div style="font-size:13px;color:#78350f;line-height:1.6">
        1. Scanner Google avec : nom + ville, nom + téléphone, "email" (entre guillemets)<br>
        2. Parcourir la liste des sites : <code>scripts/privacy/sites-france.md</code> (annuaires d'abord)<br>
        3. Envoyer les demandes d'effacement : gabarit <code>scripts/privacy/template-rgpd-art17.md</code><br>
        4. Mettre à jour la ligne dans Supabase → <code>privacy_requests</code> (status + notes)<br>
        5. Le client voit l'avancement dans son espace · ~30 min le 1er, ~10 min ensuite
      </div>
    </div>

    <a href="https://app.supabase.com" style="display:inline-block;background:#2D5BFF;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Ouvrir Supabase →</a>
  </div>
  <div style="text-align:center;padding:16px;font-size:11px;color:#9ca3af">Despy · Notification interne · Ne pas transférer</div>
</div>`;

    try {
      await sendResend(adminEmail, subject, html);
    } catch (e) {
      console.error('Resend email error:', e.message);
      // Continue : on ne fait pas échouer la requête pour autant
    }

    // Email de confirmation au client
    const clientSubject = "🕵️ Privacy Cleanup activé — Premier rapport sous 7 jours";
    const clientHtml = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
  <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#5ee4ff;font-weight:800;margin-bottom:8px">Privacy Cleanup activé</div>
    <div style="font-size:24px;font-weight:900;line-height:1.2">Bonjour ${prenom} 👋</div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none">
    <p style="color:#374151;line-height:1.7;font-size:15px;margin:0 0 18px">
      <strong>Bienvenue dans Privacy Cleanup.</strong> Vos informations sont enregistrées et sécurisées en France.
    </p>

    <div style="background:#f9fafb;border-radius:10px;padding:18px;margin-bottom:18px">
      <div style="font-weight:700;color:#111827;margin-bottom:10px;font-size:14px">Ce qui se passe maintenant :</div>
      <ol style="margin:0;padding-left:20px;color:#4b5563;line-height:1.8;font-size:14px">
        <li><strong>Sous 7 jours</strong> : scan complet des principaux annuaires et courtiers de données</li>
        <li><strong>Sous 14 jours</strong> : premières demandes RGPD article 17 envoyées</li>
        <li><strong>Sous 30 jours</strong> : la majorité des sites doivent supprimer vos données (délai légal UE)</li>
        <li><strong>Chaque mois</strong> : re-scan pour s'assurer qu'elles ne réapparaissent pas</li>
      </ol>
    </div>

    <a href="https://despy.fr/?showspace=1" style="display:inline-block;background:#2D5BFF;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Suivre l'avancement →</a>

    <p style="color:#6b7280;font-size:12px;line-height:1.6;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px">
      Vous pouvez désactiver Privacy Cleanup à tout moment depuis votre espace client.<br>
      Vos données ne sont jamais revendues et restent stockées en France (Supabase Paris 🇫🇷).
    </p>
  </div>
</div>`;

    try {
      await sendResend(user_email, clientSubject, clientHtml);
    } catch (e) {
      console.warn('Resend client email error:', e.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "Demande enregistrée. Premier rapport sous 7 jours.",
      })
    };

  } catch (err) {
    console.error('privacy-request error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur', detail: err.message })
    };
  }
};
