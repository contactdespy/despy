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
    const nextScan = new Date(activatedAt.getTime() + 30 * 86400000).toISOString();

    // ── Construction des ÉLÉMENTS RÉELS visibles par le client ──
    // Deux sources, toutes deux factuelles / validées :
    //   1. Demandes RGPD réellement envoyées (privacy_dispatch_log)
    //   2. Trouvailles du scan VALIDÉES par l'équipe (privacy_findings status=validated)
    // Rien d'autre n'est exposé (les trouvailles non validées / ignorées restent invisibles).
    const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
    const CAT_LABEL = { annuaire: 'Annuaire', reseau_social: 'Réseau social', presse_blog: 'Article / blog', donnees_legales: 'Registre légal', autre: 'Site web' };
    const items = [];

    // 1. Demandes RGPD envoyées
    try {
      const { data: logs } = await supabase
        .from('privacy_dispatch_log')
        .select('broker_name, status, sent_at')
        .eq('user_email', email);
      (logs || []).forEach(l => items.push({
        name: l.broker_name || 'Annuaire',
        kind: 'Demande de suppression envoyée',
        status: l.status === 'confirmed' ? 'supprime' : 'encours',
        date: l.sent_at
      }));
    } catch (e) { console.warn('dispatch log read:', e.message); }

    // 2. Trouvailles validées
    try {
      const { data: finds } = await supabase
        .from('privacy_findings')
        .select('url, category, action, status, reason, found_at')
        .eq('user_email', email)
        .eq('status', 'validated');
      (finds || []).forEach(f => {
        const dom = domainOf(f.url);
        const label = CAT_LABEL[f.category] || 'Site web';
        // guide_client = une action côté client (ex. profil LinkedIn) ; sinon suppression en cours
        const status = f.action === 'guide_client' ? 'action' : 'encours';
        items.push({
          name: dom ? `${label} · ${dom}` : label,
          kind: f.action === 'guide_client' ? 'Une action de votre part' : 'Suppression en cours',
          status,
          hint: f.action === 'guide_client' ? (f.reason || '') : '',
          url: f.url,
          date: f.found_at
        });
      });
    } catch (e) { console.warn('findings read:', e.message); }

    const stats = {
      supprime: items.filter(i => i.status === 'supprime').length,
      encours:  items.filter(i => i.status === 'encours').length,
      action:   items.filter(i => i.status === 'action').length,
      total:    items.length
    };

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
        items,
        stats,
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
