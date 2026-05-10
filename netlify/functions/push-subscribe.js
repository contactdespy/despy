// ════════════════════════════════════════════
// DESPY — Enregistre une subscription push browser
// POST { subscription, email? }
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { subscription, email } = JSON.parse(event.body || '{}');
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Subscription invalide' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const normEmail = email && email.includes('@') ? email.toLowerCase().trim() : null;

    // Upsert : si endpoint existe déjà, mettre à jour, sinon insérer
    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      email: normEmail,
      created_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });

    if (error) {
      console.error('push-subscribe insert:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur enregistrement' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('push-subscribe error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
