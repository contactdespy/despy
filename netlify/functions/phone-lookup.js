// ════════════════════════════════════════════
// DESPY — Annuaire inversé d'arnaqueurs
// POST { phone } → renvoie nb signalements + catégories
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, '');
  // +33XXXXXXXXX → 0XXXXXXXXX
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  else if (p.startsWith('0033')) p = '0' + p.slice(4);
  // 33XXXXXXXXX → 0XXXXXXXXX
  if (p.length === 11 && p.startsWith('33')) p = '0' + p.slice(2);
  // Doit faire 10 chiffres et commencer par 0
  if (!/^0[1-9]\d{8}$/.test(p)) return null;
  return p;
}

const CATEGORY_LABELS = {
  faux_microsoft:  'Faux support Microsoft / Apple',
  faux_cpf:        'Arnaque CPF / formation',
  faux_ameli:      'Faux Ameli / Sécu',
  faux_caf:        'Faux CAF',
  faux_impots:     'Faux impôts / DGFiP',
  faux_banque:     'Usurpation banque',
  faux_livraison:  'Faux colis / livraison',
  vente_forcee:    'Démarchage / vente forcée',
  spam:            'Spam / appels masqués répétés',
  autre:           'Autre arnaque'
};

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { phone } = JSON.parse(event.body || '{}');
    const norm = normalizePhone(phone);
    if (!norm) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Numéro invalide. Format attendu : 06XXXXXXXX ou +33...' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: reports, error } = await supabase
      .from('phone_reports')
      .select('category, comment, created_at')
      .eq('phone', norm)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('phone-lookup query error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur base de données' }) };
    }

    const total = (reports || []).length;
    const categories = {};
    (reports || []).forEach(r => {
      const k = r.category || 'autre';
      categories[k] = (categories[k] || 0) + 1;
    });
    const topCategory = Object.keys(categories).sort((a, b) => categories[b] - categories[a])[0] || null;
    const recentComments = (reports || [])
      .filter(r => r.comment && r.comment.trim().length > 0)
      .slice(0, 5)
      .map(r => ({ comment: r.comment, date: r.created_at }));

    let verdict = 'unknown';
    if (total === 0) verdict = 'unknown';
    else if (total >= 5) verdict = 'scam';
    else if (total >= 1) verdict = 'suspicious';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        phone: norm,
        verdict,
        total,
        categories: Object.entries(categories).map(([k, v]) => ({
          key: k,
          label: CATEGORY_LABELS[k] || k,
          count: v
        })).sort((a, b) => b.count - a.count),
        top_category: topCategory ? (CATEGORY_LABELS[topCategory] || topCategory) : null,
        recent_comments: recentComments,
        last_seen: reports && reports.length ? reports[0].created_at : null
      })
    };

  } catch (err) {
    console.error('phone-lookup error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
