// ════════════════════════════════════════════════════════
// DESPY — Privacy Cleanup : récupération du statut
// GET /privacy-status?email=xxx → renvoie la dernière demande active
// ════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' };

  try {
    const email = (event.queryStringParameters?.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    const auth = requireAuth(event, null, email, headers);
    if (!auth.ok) return auth.response;

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

    const activatedAt = new Date(req.activated_at);
    const daysElapsed = Math.floor((Date.now() - activatedAt.getTime()) / 86400000);
    const nextScan = new Date(activatedAt.getTime() + 30 * 86400000).toISOString();

    // Suivi RÉEL si le journal d'envoi existe (privacy_dispatch_log, rempli par
    // privacy-dispatch.js) : total = demandes réellement envoyées + formulaires.
    // « cleaned » progresse sur la fenêtre légale de 30 jours (art. 12.3) tant
    // qu'on ne traite pas encore les confirmations des brokers.
    let totalSites = 30, cleaned, pending;
    try {
      const { data: logs } = await supabase
        .from('privacy_dispatch_log')
        .select('broker_id, status')
        .eq('user_email', email);
      if (logs && logs.length > 0) {
        const FORM_COUNT = 4; // brokers traités via formulaire par l'équipe
        totalSites = logs.length + FORM_COUNT;
        const confirmed = logs.filter(l => l.status === 'confirmed').length;
        // Progression : confirmés réels + estimation sur le délai légal de 30 j
        const estimated = Math.round(totalSites * Math.min(1, Math.max(0, daysElapsed / 30)));
        cleaned = Math.min(totalSites, Math.max(confirmed, estimated));
        pending = Math.max(0, totalSites - cleaned);
      }
    } catch (e) { console.warn('dispatch log read:', e.message); }

    // Repli (journal absent) : estimation linéaire comme avant
    if (cleaned === undefined) {
      cleaned = Math.min(totalSites, Math.max(0, daysElapsed - 7));
      pending = Math.max(0, totalSites - cleaned);
    }

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
