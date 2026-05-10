// ════════════════════════════════════════════
// DESPY — Signaler un numéro d'arnaqueur
// POST { phone, category, comment?, email? }
// Rate limit : 5 signalements/IP/heure
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  else if (p.startsWith('0033')) p = '0' + p.slice(4);
  if (p.length === 11 && p.startsWith('33')) p = '0' + p.slice(2);
  if (!/^0[1-9]\d{8}$/.test(p)) return null;
  return p;
}

const VALID_CATEGORIES = [
  'faux_microsoft', 'faux_cpf', 'faux_ameli', 'faux_caf', 'faux_impots',
  'faux_banque', 'faux_livraison', 'vente_forcee', 'spam', 'autre'
];

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { phone, category, comment, email } = JSON.parse(event.body || '{}');
    const norm = normalizePhone(phone);
    if (!norm) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Numéro invalide' }) };
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Catégorie invalide' }) };
    }
    const cleanComment = (comment || '').toString().trim().slice(0, 240);
    const cleanEmail = email && email.includes('@') ? email.toLowerCase().trim() : null;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const ip = (event.headers['x-forwarded-for'] || '0.0.0.0').split(',')[0].trim();

    // Rate limit : 5 par heure par IP
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from('phone_reports')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', since);
    if ((recentCount || 0) >= 5) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de signalements. Attendez 1 heure.' }) };
    }

    // Anti-doublon : si même IP a déjà signalé ce numéro avec cette catégorie dans les 24h, refuse
    const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: dup } = await supabase
      .from('phone_reports')
      .select('id')
      .eq('ip', ip).eq('phone', norm).eq('category', category)
      .gte('created_at', day)
      .maybeSingle();
    if (dup) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Vous avez déjà signalé ce numéro pour cette catégorie aujourd\'hui.' }) };
    }

    const { error } = await supabase.from('phone_reports').insert({
      phone: norm,
      category,
      comment: cleanComment || null,
      email: cleanEmail,
      ip,
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error('phone-report insert:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur d\'enregistrement' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Merci, votre signalement aide la communauté Despy.' })
    };

  } catch (err) {
    console.error('phone-report error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
