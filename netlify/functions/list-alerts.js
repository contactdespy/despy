// ════════════════════════════════════════════
// DESPY — Liste des alertes nationales récentes
// Lecture publique (info non sensible) : ANSSI/CERT-FR
// + vagues d'arnaques détectées en interne.
// Alimentée par le cron national-alerts.js.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// Ne garder que les alertes pertinentes pour le grand public senior.
// Les vagues d'arnaques internes passent toujours ; les avis ANSSI
// purement techniques (CVE, vulnérabilités produits) sont écartés.
function isPublicRelevant(alert) {
  const source = (alert.source || '').toUpperCase();
  if (source.indexOf('ANSSI') === -1) return true;
  // Pour l'ANSSI : uniquement le contenu qui parle réellement au grand public.
  // Les bulletins/avis techniques (CVE, "Vulnérabilité dans X", etc.) sont écartés.
  const text = ((alert.title || '') + ' ' + (alert.body || '')).toLowerCase();
  const KEYWORDS = [
    'phishing', 'hameçonnage', 'hameconnage', 'arnaque', 'fraude', 'escroquerie', 'escroc',
    'smishing', 'vishing', 'faux sms', 'faux courriel', 'faux mail', 'usurpation',
    'rançongiciel', 'rancongiciel', 'vol de données', 'vol de donnees',
    'fuite de données', 'fuite de donnees', 'démarchage', 'demarchage',
    'faux support', 'faux conseiller', 'carte bancaire', 'compte bancaire'
  ];
  return KEYWORDS.some(k => text.indexOf(k) !== -1);
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data, error } = await supabase
      .from('national_alerts')
      .select('title, body, source, url, created_at')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) {
      console.error('list-alerts error:', error);
      return { statusCode: 200, headers, body: JSON.stringify({ alerts: [] }) };
    }

    const alerts = (data || []).filter(isPublicRelevant).slice(0, 15);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ alerts })
    };

  } catch (err) {
    console.error('list-alerts error:', err);
    return { statusCode: 200, headers, body: JSON.stringify({ alerts: [] }) };
  }
};
