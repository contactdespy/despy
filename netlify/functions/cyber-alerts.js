// ════════════════════════════════════════════
// DESPY — Alertes Cybermenaces Automatisées
// Cron : tous les jours à 8h → 0 8 * * *
// Sources : ANSSI, Cybermalveillance, CERT-FR
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// Sources RSS officielles françaises de cybermenaces
const RSS_SOURCES = [
  {
    name: 'ANSSI',
    url: 'https://www.cert.ssi.gouv.fr/feed/',
    type: 'cert'
  },
  {
    name: 'Cybermalveillance.gouv.fr',
    url: 'https://www.cybermalveillance.gouv.fr/feed/',
    type: 'awareness'
  }
];

// Mots-clés qui déclenchent une alerte urgente aux abonnés
const URGENT_KEYWORDS = [
  'arnaque', 'phishing', 'fraude', 'escroquerie', 'ransomware',
  'particuliers', 'seniors', 'retraite', 'banque', 'impots',
  'ameli', 'caf', 'la poste', 'chronopost', 'livraison',
  'sms', 'whatsapp', 'facebook', 'credential'
];

async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Despy-Alerts/1.0 (contact.despy@gmail.com)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const text = await res.text();
    return parseRSSItems(text);
  } catch (e) {
    console.error(`RSS fetch error ${url}:`, e.message);
    return null;
  }
}

function parseRSSItems(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const desc = extractTag(item, 'description');
    const link = extractTag(item, 'link');
    const pubDate = extractTag(item, 'pubDate');
    if (title) items.push({ title, desc, link, pubDate });
  }
  return items.slice(0, 5); // Max 5 items par source
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function isUrgentAlert(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  return URGENT_KEYWORDS.some(kw => text.includes(kw));
}

async function sendAlertToSubscribers(supabase, alert) {
  const { data: clients } = await supabase
    .from('clients')
    .select('email, name, prenom')
    .eq('subscribed', true);

  if (!clients || clients.length === 0) return 0;

  let sent = 0;
  for (const client of clients) {
    const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';
    try {
      await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'cyber_alert',
          data: {
            email: client.email,
            prenom,
            alertTitle: alert.title,
            alertDesc: alert.desc,
            alertLink: alert.link,
            alertSource: alert.source
          }
        })
      });
      sent++;
    } catch (e) { console.error('Alert email error:', e); }
    await new Promise(r => setTimeout(r, 200));
  }
  return sent;
}

exports.handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Récupérer les alertes déjà envoyées (éviter les doublons)
    const { data: sentAlerts } = await supabase
      .from('sent_alerts')
      .select('alert_url')
      .order('created_at', { ascending: false })
      .limit(50);

    const sentUrls = new Set((sentAlerts || []).map(a => a.alert_url));
    let totalSent = 0;
    let alertsTriggered = 0;

    for (const source of RSS_SOURCES) {
      const items = await fetchRSS(source.url);
      if (!items) continue;

      for (const item of items) {
        // Vérifier si déjà envoyé
        if (sentUrls.has(item.link)) continue;

        // Vérifier si c'est une alerte urgente pour les particuliers
        if (!isUrgentAlert(item.title, item.desc)) continue;

        console.log(`Alerte détectée: ${item.title}`);

        // Envoyer aux abonnés
        const sent = await sendAlertToSubscribers(supabase, {
          ...item, source: source.name
        });

        // Enregistrer l'alerte comme envoyée
        await supabase.from('sent_alerts').insert({
          alert_url: item.link,
          alert_title: item.title,
          source: source.name,
          recipients: sent,
          created_at: new Date().toISOString()
        });

        sentUrls.add(item.link);
        totalSent += sent;
        alertsTriggered++;

        // Max 2 alertes par jour pour ne pas surcharger
        if (alertsTriggered >= 2) break;
      }
      if (alertsTriggered >= 2) break;
    }

    console.log(`Alertes: ${alertsTriggered} détectées, ${totalSent} emails envoyés`);
    return { statusCode: 200, body: JSON.stringify({ alerts: alertsTriggered, emails: totalSent }) };

  } catch (err) {
    console.error('Cyber alerts error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
