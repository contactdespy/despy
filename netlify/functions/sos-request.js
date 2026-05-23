// ════════════════════════════════════════════════════════
// DESPY — SOS Humain : déclenche une demande d'intervention
// Envoie email Telegram + email Resend à Yacine
// + email de confirmation au client
// ════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

async function sendResend(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Despy SOS <contact@despy.fr>",
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

// Telegram bot — envoi push immédiat à Yacine
async function sendTelegram(text) {
  const token   = process.env.TELEGRAM_BOT_TOKEN;
  const chatId  = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("Telegram non configuré : TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant.");
    return null;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    })
  });
  if (!res.ok) {
    console.warn("Telegram error:", await res.text());
  }
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      user_email,
      type,
      type_label,
      is_critical,
      phone,
      context,
      subscribed,
      paid_one_off,
      submitted_at
    } = body;

    if (!type || !phone || !context) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Champs requis manquants' }) };
    }

    // Insert dans Supabase (silencieux si table absente)
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await supabase.from('sos_requests').insert({
        user_email: (user_email || '').toLowerCase().trim(),
        type,
        is_critical: !!is_critical,
        phone: phone.trim(),
        context: context.trim(),
        subscribed: !!subscribed,
        paid_one_off: !!paid_one_off,
        status: 'pending',
        submitted_at: submitted_at || new Date().toISOString()
      });
    } catch (e) {
      console.warn('Supabase insert failed (table may not exist):', e.message);
    }

    // ── Statut client : déterminer le tag selon abonné/payé/ni ──
    let statusTag;
    if (paid_one_off) {
      statusTag = "💰 <b>PAYÉ 49 €</b> (non-abonné)";
    } else if (subscribed) {
      statusTag = "✅ Abonné";
    } else {
      statusTag = "⚠️ <b>Non-abonné — N'A PAS PAYÉ</b> (à orienter vers Stripe)";
    }

    // ── Notification TELEGRAM à Yacine (priorité 1) ──
    const urgencyTag = is_critical ? "🔴 <b>CRITIQUE — RAPPEL 15 MIN</b>" : "🟡 <b>SOS HUMAIN</b>";
    const telegramMsg =
      `${urgencyTag}\n\n` +
      `<b>Type :</b> ${type_label || type}\n` +
      `<b>Statut :</b> ${statusTag}\n` +
      `<b>Email :</b> ${user_email || '(anonyme)'}\n` +
      `<b>Tel :</b> <a href="tel:${phone.replace(/\s/g,'')}">${phone}</a>\n\n` +
      `<b>Situation :</b>\n<i>${context.substring(0, 500)}</i>\n\n` +
      `<a href="https://despy.fr/.netlify/functions/sos-request">📋 Ouvrir le dashboard</a>`;

    try {
      await sendTelegram(telegramMsg);
    } catch (e) {
      console.warn('Telegram notif failed:', e.message);
    }

    // ── Notification EMAIL à Yacine (backup si Telegram down) ──
    const adminEmail = "contact.despy@gmail.com";
    const paidPrefix = paid_one_off ? '💰 PAYÉ — ' : '';
    const adminSubject = `${paidPrefix}${is_critical ? '🔴 SOS CRITIQUE' : '🆘 SOS Humain'} — ${type_label || type}`;
    const adminHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#f9fafb">
  <div style="background:linear-gradient(135deg,${is_critical ? '#7f1d1d,#dc2626' : '#f59e0b,#d97706'});color:#fff;padding:24px;border-radius:12px 12px 0 0">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fef3c7;font-weight:800;margin-bottom:6px">${is_critical ? 'CRITIQUE - 15 MIN' : 'SOS HUMAIN'}</div>
    <div style="font-size:22px;font-weight:900">${type_label || type}</div>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px">Type</td><td style="padding:8px 0;font-weight:700">${type_label || type}</td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Statut</td><td style="padding:8px 0;font-weight:700">${paid_one_off ? '💰 PAYÉ 49 € (non-abonné)' : (subscribed ? '✅ Abonné Despy' : '⚠️ Non-abonné — n\'a pas encore payé')}</td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Email client</td><td style="padding:8px 0;font-weight:700">${user_email || '(anonyme)'}</td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Téléphone</td><td style="padding:8px 0;font-weight:700"><a href="tel:${phone.replace(/\s/g,'')}" style="color:#2D5BFF">${phone}</a></td></tr>
      <tr style="border-top:1px solid #f3f4f6"><td style="padding:8px 0;color:#6b7280;font-size:13px">Soumis le</td><td style="padding:8px 0;font-weight:700">${new Date(submitted_at || Date.now()).toLocaleString('fr-FR')}</td></tr>
    </table>

    <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px;margin-bottom:18px">
      <div style="font-weight:700;color:#78350f;margin-bottom:6px">📝 Description du client</div>
      <div style="font-size:14px;color:#78350f;line-height:1.6;white-space:pre-wrap">${context.substring(0, 1000)}</div>
    </div>

    ${is_critical ?
      '<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:6px;margin-bottom:18px"><div style="font-weight:800;color:#991b1b;margin-bottom:6px">⚠️ CAS CRITIQUE — Rappel sous 15 min</div><div style="font-size:13px;color:#991b1b;line-height:1.6">Appel direct prioritaire. Si tu es au bureau, sors discrètement. Si tu dors, ton tel doit sonner.</div></div>'
    :
      '<div style="background:#dbeafe;border-left:4px solid #2D5BFF;padding:12px 16px;border-radius:6px;margin-bottom:18px"><div style="font-weight:700;color:#1e40af;margin-bottom:6px">Délais à respecter</div><div style="font-size:13px;color:#1e40af;line-height:1.6">Soirée/week-end : sous 30 min<br>Journée semaine : sous 4h<br>Nuit : avant 9h30 lendemain</div></div>'
    }

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:800;font-size:14px">📞 Rappeler maintenant</a>
      <a href="mailto:${user_email || ''}" style="display:inline-block;padding:12px 24px;background:#2D5BFF;color:#fff;text-decoration:none;border-radius:8px;font-weight:800;font-size:14px">✉️ Email</a>
    </div>
  </div>
  <div style="text-align:center;padding:16px;font-size:11px;color:#9ca3af">Despy · Notification interne · ID demande : ${Date.now()}</div>
</div>`;

    try {
      await sendResend(adminEmail, adminSubject, adminHtml);
    } catch (e) {
      console.warn('Resend admin email failed:', e.message);
    }

    // ── Confirmation au client ──
    if (user_email && user_email.includes('@') && user_email !== 'anonymous@despy.fr') {
      const clientSubject = is_critical ? "🆘 SOS reçu — Rappel sous 15 min" : "🆘 SOS Humain — Demande reçue";
      const delay = is_critical ? "moins de 15 minutes" : "30 minutes maximum (soirée/week-end) ou 4 heures (journée)";
      const clientHtml = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
  <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fef3c7;font-weight:800;margin-bottom:8px">SOS Humain</div>
    <div style="font-size:22px;font-weight:900">Votre demande est bien reçue</div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <p style="color:#374151;line-height:1.7;font-size:15px;margin:0 0 18px">
      <strong>Despy vient de recevoir votre SOS.</strong> Un humain va vous rappeler au <strong>${phone}</strong> dans <strong>${delay}</strong>.
    </p>

    <div style="background:#fef3c7;border-radius:10px;padding:18px;margin-bottom:18px">
      <div style="font-weight:700;color:#78350f;margin-bottom:10px;font-size:14px">⏳ En attendant l'appel :</div>
      <ul style="margin:0;padding-left:20px;color:#78350f;line-height:1.7;font-size:14px">
        <li>Restez calme — vous n'êtes plus seul</li>
        <li>Ne payez RIEN sous la pression (banque, "support", autre)</li>
        <li>Notez tout ce qui se passe (montants, dates, captures d'écran)</li>
        <li>Ne supprimez rien — les preuves comptent pour la suite</li>
      </ul>
    </div>

    <p style="color:#6b7280;font-size:12.5px;line-height:1.6;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px">
      <strong>Rappel important :</strong> Despy vous accompagne et coordonne, mais ne se substitue pas à votre banque, la police ou un avocat. Notre rôle est de maximiser vos chances de récupération en agissant vite et bien.
    </p>
  </div>
</div>`;

      try {
        await sendResend(user_email, clientSubject, clientHtml);
      } catch (e) {
        console.warn('Resend client email failed:', e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: is_critical ? "SOS critique reçu, rappel sous 15 min" : "SOS reçu, rappel programmé"
      })
    };

  } catch (err) {
    console.error('sos-request error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur', detail: err.message })
    };
  }
};
