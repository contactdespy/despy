// ════════════════════════════════════════════
// DESPY — Renvoie la clé publique VAPID
// Le frontend en a besoin pour s'abonner aux push
// ════════════════════════════════════════════

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'VAPID non configuré' }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ publicKey }) };
};
