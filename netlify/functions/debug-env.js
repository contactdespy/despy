// ════════════════════════════════════════════
// DESPY — Debug temporaire : liste les env vars visibles
// (NE renvoie PAS les valeurs, juste si elles existent)
// À SUPPRIMER après diagnostic
// ════════════════════════════════════════════

exports.handler = async () => {
  const vars = [
    'FACEBOOK_APP_ID',
    'FACEBOOK_PAGE_ID',
    'FACEBOOK_APP_SECRET',
    'FACEBOOK_USER_TOKEN',
    'ANTHROPIC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY'
  ];
  const status = {};
  vars.forEach(v => {
    const val = process.env[v];
    status[v] = {
      defined: typeof val !== 'undefined',
      empty: !val,
      length: val ? val.length : 0,
      firstChars: val ? val.slice(0, 3) + '...' : null,
      lastChars: val ? '...' + val.slice(-3) : null
    };
  });
  // Liste aussi toutes les keys contenant "FACEBOOK" pour repérer un typo
  const allFacebookKeys = Object.keys(process.env).filter(k => k.toUpperCase().includes('FACEBOOK'));
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expected: status,
      allFacebookKeys
    }, null, 2)
  };
};
