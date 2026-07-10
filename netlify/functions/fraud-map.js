// ════════════════════════════════════════════
// DESPY — Alerte Secteur : données de la carte publique
// GET (public) → signalements APPROUVÉS des 60 derniers jours,
// agrégés par commune : compteurs + catégories pour tout le monde,
// descriptions détaillées uniquement pour les comptes connectés
// (softAuth) — c'est la frontière « carte publique, détails réservés ».
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { softAuth } = require('./_auth');
const { CATEGORIES } = require('./_fraud-alerts');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'public, max-age=300' // 5 min de cache CDN
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{}' };

  try {
    const auth = softAuth(event, null, null);
    const connected = !!(auth.ok && auth.verified);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const since = new Date(Date.now() - 60 * 86400000).toISOString();

    const { data: reports, error } = await supabase
      .from('fraud_reports')
      .select('category, description, ville, code_postal, lat, lng, created_at')
      .eq('status', 'approved')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.warn('fraud-map select (migration manquante ?):', error.message);
      return { statusCode: 200, headers, body: JSON.stringify({ communes: [], total: 0 }) };
    }

    // Agrégation par commune
    const byCommune = new Map();
    for (const r of (reports || [])) {
      const key = `${r.code_postal}|${r.ville}`;
      if (!byCommune.has(key)) {
        byCommune.set(key, { ville: r.ville, code_postal: r.code_postal, lat: r.lat, lng: r.lng, count: 0, categories: {}, last_at: r.created_at, items: [] });
      }
      const c = byCommune.get(key);
      c.count++;
      c.categories[r.category] = (c.categories[r.category] || 0) + 1;
      if (r.created_at > c.last_at) c.last_at = r.created_at;
      // Détails (descriptions modérées) réservés aux connectés, max 5/commune
      if (connected && c.items.length < 5) {
        c.items.push({
          category: r.category,
          label: CATEGORIES[r.category] || r.category,
          description: r.description,
          date: (r.created_at || '').slice(0, 10)
        });
      }
    }

    const communes = [...byCommune.values()].filter(c => c.lat && c.lng);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        communes,
        total: (reports || []).length,
        connected,
        categories: CATEGORIES
      })
    };
  } catch (e) {
    console.error('fraud-map:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ communes: [], total: 0 }) };
  }
};
