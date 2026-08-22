// ════════════════════════════════════════════════════════
// DESPY — Demande de prestation « Parlez à un expert »
// (49 € à distance · 89 € à domicile · 129 € forfait complet)
//
// Pourquoi cette fonction existe : le formulaire postait vers EmailJS avec
// la clé `despy_public`, qui n'a jamais été valide — l'API répond « The
// Public Key is invalid », exactement comme pour une clé inventée. L'échec
// était avalé par un `catch(e){}` vide, puis « Demande envoyée ! » s'affichait
// quoi qu'il arrive. Toutes les demandes payantes depuis avril sont perdues.
//
// On passe donc par l'infrastructure qui fonctionne déjà (Resend + Telegram,
// celle du SOS), et surtout : on ne renvoie `ok` que si Yacine a réellement
// été prévenu. Un formulaire ne doit jamais dire « envoyé » sans l'être.
// ════════════════════════════════════════════════════════

const { rateLimit } = require('./_auth');

const ADMIN_EMAIL = 'contact.despy@gmail.com';

const PRESTATIONS = {
  distance: { nom: 'À distance',      prix: '49 €',  detail: 'Visio ou téléphone' },
  domicile: { nom: 'À domicile',      prix: '89 €',  detail: 'Bas-Rhin (67)' },
  forfait:  { nom: 'Forfait complet', prix: '129 €', detail: 'Tous appareils' }
};

function echapper(s) {
  return String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

async function sendResend(to, subject, html, replyTo) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(Object.assign(
      { from: 'Despy <contact@despy.fr>', to: [to], subject, html },
      replyTo ? { reply_to: replyTo } : {}
    ))
  });
  if (!res.ok) throw new Error('Resend: ' + (await res.text()));
  return res.json();
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  if (!res.ok) console.warn('Telegram:', await res.text());
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Formulaire public : pas d'authentification, mais on borne les envois.
  if (!rateLimit(event, 'conseil', 5, 60 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de demandes. Réessayez dans une heure.' }) };
  }

  try {
    const b = JSON.parse(event.body || '{}');
    const nom = String(b.name || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const tel = String(b.tel || '').trim().slice(0, 30);
    const message = String(b.message || '').trim().slice(0, 4000);
    const presta = PRESTATIONS[b.type] || PRESTATIONS.distance;

    if (!nom || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Merci d’indiquer votre prénom et votre demande.' }) };
    }
    if (!email || !email.includes('@') || !email.includes('.')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Adresse email invalide.' }) };
    }

    const quand = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    // ── 1. Telegram : la voie la plus rapide pour être prévenu ──
    try {
      await sendTelegram(
        `💼 <b>Demande de prestation</b>\n\n` +
        `<b>${echapper(nom)}</b> — ${presta.nom} (${presta.prix})\n` +
        `📧 ${echapper(email)}\n` +
        (tel ? `📞 ${echapper(tel)}\n` : '') +
        `\n${echapper(message).slice(0, 500)}`
      );
    } catch (e) { console.warn('Telegram conseil:', e.message); }

    // ── 2. L'email à Yacine — c'est LUI qui décide du succès ──
    // Si ce message ne part pas, la demande est perdue : on doit le dire au
    // visiteur plutôt que d'afficher un faux « envoyé ».
    const html =
      `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:24px;color:#fff;border-radius:14px 14px 0 0">
          <div style="font-size:11px;letter-spacing:2px;opacity:.85;font-weight:700">DESPY — DEMANDE DE PRESTATION</div>
          <div style="font-size:22px;font-weight:900;margin-top:6px">${echapper(presta.nom)} · ${presta.prix}</div>
          <div style="font-size:13px;opacity:.85;margin-top:4px">${presta.detail} — reçue le ${quand}</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px;padding:24px">
          <table style="width:100%;font-size:15px;color:#0a1f3a;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666;width:110px">Prénom</td><td style="padding:6px 0"><b>${echapper(nom)}</b></td></tr>
            <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0"><a href="mailto:${echapper(email)}">${echapper(email)}</a></td></tr>
            ${tel ? `<tr><td style="padding:6px 0;color:#666">Téléphone</td><td style="padding:6px 0"><a href="tel:${echapper(tel)}">${echapper(tel)}</a></td></tr>` : ''}
          </table>
          <div style="margin-top:18px;padding:16px;background:#f7f9fc;border-radius:10px;font-size:15px;line-height:1.7;color:#333;white-space:pre-wrap">${echapper(message)}</div>
          <a href="mailto:${echapper(email)}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#2D5BFF;color:#fff;text-decoration:none;border-radius:9px;font-weight:800;font-size:14px">Répondre à ${echapper(nom)}</a>
        </div>
      </div>`;

    await sendResend(ADMIN_EMAIL, `💼 ${presta.nom} (${presta.prix}) — ${nom}`, html, email);

    // ── 3. Confirmation au client (secondaire : ne doit pas faire échouer) ──
    try {
      await sendResend(email, 'Votre demande est bien arrivée — Despy',
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:26px;color:#fff;border-radius:14px 14px 0 0">
            <div style="font-size:21px;font-weight:900">Bonjour ${echapper(nom)},</div>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px;padding:24px;font-size:15px;line-height:1.75;color:#333">
            <p>Votre demande <b>${echapper(presta.nom)} (${presta.prix})</b> est bien arrivée. Je la lis moi-même et je vous réponds personnellement, généralement sous 24 h ouvrées.</p>
            <p>Si c'est urgent, appelez-moi directement au <a href="tel:+33689148395"><b>06 89 14 83 95</b></a>.</p>
            <p style="color:#666;font-size:14px">À très vite,<br>Yacine — Despy</p>
          </div>
        </div>`);
    } catch (e) { console.warn('Confirmation client non envoyée:', e.message); }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('conseil-request:', err && err.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Envoi impossible pour le moment. Appelez-nous au 06 89 14 83 95.' })
    };
  }
};
