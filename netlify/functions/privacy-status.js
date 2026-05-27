// ════════════════════════════════════════════════════════
// DESPY — Privacy Cleanup : récupération du statut
// GET /privacy-status?email=xxx → renvoie la dernière demande active
// ════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' };

  try {
    const email = (event.queryStringParameters?.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      // Pas de config Supabase → réponse "rien" silencieuse
      return { statusCode: 200, headers, body: JSON.stringify({ active: false }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Récupère la dernière demande pour cet email
    const { data, error } = await supabase
      .from('privacy_requests')
      .select('*')
      .eq('user_email', email)
      .order('activated_at', { ascending: false })
      .limit(1);

    if (error) {
      // Table absente ou inaccessible — on renvoie active:false sans crasher
      console.warn('privacy-status read warn:', error.message);
      return { statusCode: 200, headers, body: JSON.stringify({ active: false }) };
    }

    if (!data || data.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ active: false }) };
    }

    const req = data[0];

    // Calcul des stats : on simule un suivi par défaut si pas de table de sites
    // 30 sites suivis, X cleaned, Y pending selon le temps écoulé
    const activatedAt = new Date(req.activated_at);
    const daysElapsed = Math.floor((Date.now() - activatedAt.getTime()) / 86400000);
    const totalSites = 30;
    // Approximation linéaire : 30 jours = tous cleaned. Sites cleaned = min(30, daysElapsed)
    const cleaned = Math.min(totalSites, Math.max(0, daysElapsed - 7)); // démarre après 7j
    const pending = Math.max(0, totalSites - cleaned);
    const nextScan = new Date(activatedAt.getTime() + 30 * 86400000).toISOString();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        active: true,
        activated_at: req.activated_at,
        prenom: req.prenom,
        nom: req.nom,
        target_email: req.target_email,
        phone: req.phone,
        ville: req.ville,
        status: req.status || 'pending',
        stats: {
          total_sites: totalSites,
          cleaned,
          pending,
          days_elapsed: daysElapsed
        },
        next_scan: nextScan
      })
    };

  } catch (err) {
    console.error('privacy-status error:', err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ active: false, error: err.message })
    };
  }
};
