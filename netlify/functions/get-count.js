// ════════════════════════════════════════════
// DESPY — Compteur membres en temps réel
// Appelé depuis le site pour afficher le vrai nombre
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Compter tous les inscrits (gratuit + payant)
    const { count: totalCount } = await supabase
      .from('clients')
      .select('*', { count: 'exact', head: true });

    // Compter les abonnés payants
    const { count: subscribedCount } = await supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('subscribed', true);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count: totalCount || 0,
        subscribed: subscribedCount || 0,
        spots: Math.max(0, 50 - (totalCount || 0))
      })
    };

  } catch (err) {
    console.error('Get count error:', err);
    // Retourner une valeur par défaut en cas d'erreur
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ count: 0, subscribed: 0, spots: 50 })
    };
  }
};
