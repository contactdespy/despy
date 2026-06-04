// ════════════════════════════════════════════
// DESPY — Liste des alertes nationales récentes
// Lecture publique (info non sensible) : ANSSI/CERT-FR
// + vagues d'arnaques détectées en interne.
// Alimentée par le cron national-alerts.js.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

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
      .limit(15);

    if (error) {
      console.error('list-alerts error:', error);
      return { statusCode: 200, headers, body: JSON.stringify({ alerts: [] }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ alerts: data || [] })
    };

  } catch (err) {
    console.error('list-alerts error:', err);
    return { statusCode: 200, headers, body: JSON.stringify({ alerts: [] }) };
  }
};
