// ════════════════════════════════════════════
// DESPY — Génère les icônes PNG de la PWA
// Endpoints :
//   /icon?size=192          → 192x192 (any)
//   /icon?size=512          → 512x512 (any)
//   /icon?size=512&maskable=1 → 512x512 avec safe-zone interne (purpose=maskable)
// ════════════════════════════════════════════

const { Resvg } = require('@resvg/resvg-js');

function buildSVG(size, maskable) {
  // En mode maskable, l'icône est rognée par un masque circulaire/carré
  // On garde le bouclier dans la "safe zone" centrale (~80% du canvas)
  const safeScale = maskable ? 0.72 : 0.92; // % du canvas occupé par l'icône
  const margin = (1 - safeScale) / 2;
  const iconSize = size * safeScale;
  const iconX = size * margin;
  const iconY = size * margin;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2D5BFF"/>
      <stop offset="100%" stop-color="#1a3fd9"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <svg x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="M9 12l2 2 4-4"/>
  </svg>
</svg>`;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const size = Math.min(Math.max(parseInt(params.size, 10) || 192, 16), 1024);
  const maskable = params.maskable === '1';

  try {
    const svg = buildSVG(size, maskable);
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
    const png = resvg.render().asPng();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      },
      body: png.toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    console.error('icon error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
