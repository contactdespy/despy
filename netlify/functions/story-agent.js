// ════════════════════════════════════════════
// DESPY — Agent Story Facebook automatique
// Cron : chaque jour à 12h UTC (= 14h Paris l'été, 13h l'hiver)
//
// 1. Récupère le dernier post Facebook du jour
// 2. Extrait l'accroche
// 3. Génère une image 1080x1920 (style "Quote Card", branding Despy)
// 4. Upload l'image sur Facebook (photo non publiée)
// 5. Publie en story photo (visible 24h)
// 6. Log dans social_posts
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const FB_API_VERSION = 'v18.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_API_VERSION}`;

// ── Chemin de la police bundlée dans le repo ──
const FONT_PATH = path.join(__dirname, '_assets', 'font.ttf');
function getFontPath() {
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error('Police introuvable : ' + FONT_PATH);
  }
  return FONT_PATH;
}

// ── Helpers texte ────────────────────────────

// Inverse de la conversion bold Unicode → ASCII (pour rendu dans SVG)
const ASCII_MAP = (() => {
  const map = {};
  for (let i = 0; i < 26; i++) {
    map[String.fromCodePoint(0x1D5D4 + i)] = String.fromCharCode(65 + i);   // 𝗔-𝗭 → A-Z
    map[String.fromCodePoint(0x1D5EE + i)] = String.fromCharCode(97 + i);   // 𝗮-𝘇 → a-z
  }
  for (let i = 0; i < 10; i++) {
    map[String.fromCodePoint(0x1D7EC + i)] = String(i);                     // 𝟬-𝟵 → 0-9
  }
  return map;
})();

function stripBoldUnicode(text) {
  let result = '';
  for (const ch of text) {
    result += ASCII_MAP[ch] || ch;
  }
  return result;
}

function extractHook(postContent) {
  // 1. Nettoyer le bold Unicode
  const clean = stripBoldUnicode(postContent).trim();
  // 2. Prendre la première ligne
  const firstLine = clean.split('\n')[0].trim();
  // 3. Limiter à 110 caractères max pour la story
  if (firstLine.length <= 110) return firstLine;
  // 4. Sinon, première phrase
  const sentenceMatch = firstLine.match(/^[^.!?]+[.!?]/);
  if (sentenceMatch && sentenceMatch[0].length <= 110) return sentenceMatch[0].trim();
  // 5. Fallback : tronquer
  return firstLine.slice(0, 107).trim() + '…';
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
}

// ── Génération de l'image SVG → PNG ─────────

function buildStorySvg(hookText) {
  // Adapter la taille de police selon longueur
  let fontSize, maxChars;
  if (hookText.length <= 50) {
    fontSize = 84;
    maxChars = 18;
  } else if (hookText.length <= 80) {
    fontSize = 72;
    maxChars = 20;
  } else {
    fontSize = 60;
    maxChars = 24;
  }

  const lines = wrapText(hookText, maxChars);
  const lineHeight = Math.round(fontSize * 1.25);
  const totalTextHeight = lines.length * lineHeight;
  // Centrer verticalement le bloc autour de y=860
  const startY = 860 - totalTextHeight / 2 + lineHeight / 2;

  const textElements = lines.map((line, i) => {
    const y = startY + i * lineHeight;
    return `<text x="540" y="${y}" font-family="Roboto" font-size="${fontSize}" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(line)}</text>`;
  }).join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a1f3a"/>
      <stop offset="55%" stop-color="#1a3fd9"/>
      <stop offset="100%" stop-color="#2D5BFF"/>
    </linearGradient>
    <radialGradient id="halo1" cx="20%" cy="15%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo2" cx="85%" cy="90%" r="50%">
      <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect width="1080" height="1920" fill="url(#halo1)"/>
  <rect width="1080" height="1920" fill="url(#halo2)"/>

  <!-- Logo bloc (top) -->
  <g transform="translate(540, 220)">
    <text x="0" y="0" font-family="Roboto" font-size="64" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="14">DESPY</text>
    <text x="0" y="56" font-family="Roboto" font-size="22" font-weight="700" fill="#ffd700" text-anchor="middle" letter-spacing="8">CYBERSÉCURITÉ</text>
    <line x1="-40" y1="100" x2="40" y2="100" stroke="#ffd700" stroke-width="3" stroke-linecap="round"/>
  </g>

  <!-- Guillemet décoratif -->
  <text x="160" y="560" font-family="Georgia, serif" font-size="220" font-weight="900" fill="#ffffff" fill-opacity="0.12">“</text>

  <!-- Texte principal (centré) -->
  ${textElements}

  <!-- CTA bouton -->
  <g transform="translate(540, 1560)">
    <rect x="-360" y="0" width="720" height="140" rx="70" fill="#ffd700"/>
    <text x="0" y="92" font-family="Roboto" font-size="58" font-weight="900" fill="#0a1f3a" text-anchor="middle" letter-spacing="2">despy.fr  →</text>
  </g>

  <!-- Tagline bas -->
  <text x="540" y="1780" font-family="Roboto" font-size="26" font-weight="600" fill="#ffffff" fill-opacity="0.78" text-anchor="middle" letter-spacing="3">SCORE CYBER GRATUIT · 60 SECONDES</text>
</svg>`;
}

function generateStoryImage(hookText) {
  const svg = buildStorySvg(hookText);
  const fontPath = getFontPath();
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
      fontFiles: [fontPath],
      defaultFontFamily: 'Roboto',
      sansSerifFamily: 'Roboto',
      serifFamily: 'Roboto',
      cursiveFamily: 'Roboto',
      fantasyFamily: 'Roboto',
      monospaceFamily: 'Roboto'
    },
    fitTo: { mode: 'width', value: 1080 }
  });
  return resvg.render().asPng();
}

// ── Facebook API ────────────────────────────

async function getPageAccessToken(supabase) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageId) throw new Error('FACEBOOK_PAGE_ID manquant');
  const { data: cached } = await supabase
    .from('facebook_tokens')
    .select('page_access_token')
    .eq('page_id', pageId)
    .maybeSingle();
  if (cached && cached.page_access_token) return cached.page_access_token;
  throw new Error('Page Token introuvable dans Supabase. Lance d\'abord social-agent une fois.');
}

async function uploadPhoto(pngBuffer, pageId, pageToken) {
  const blob = new Blob([pngBuffer], { type: 'image/png' });
  const form = new FormData();
  form.append('source', blob, 'despy-story.png');
  form.append('published', 'false');
  form.append('access_token', pageToken);

  const res = await fetch(`${FB_GRAPH}/${pageId}/photos`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Upload photo échoué : ' + JSON.stringify(data));
  return data.id;
}

async function createPhotoStory(photoId, pageId, pageToken) {
  const params = new URLSearchParams();
  params.append('photo_id', photoId);
  params.append('access_token', pageToken);
  const res = await fetch(`${FB_GRAPH}/${pageId}/photo_stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Création story échouée : ' + JSON.stringify(data));
  return data;
}

// ── Handler ──────────────────────────────────

exports.handler = async (event) => {
  const isManual = event && event.httpMethod === 'POST';
  const isPreview = isManual && (event.queryStringParameters || {}).preview === '1';
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Récupère le dernier post Facebook publié (dans les 24h)
    let hookSource = '';
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: posts } = await supabase
      .from('social_posts')
      .select('content, post_type')
      .eq('platform', 'facebook')
      .eq('status', 'published')
      .neq('post_type', 'story')
      .gte('created_at', dayAgo)
      .order('created_at', { ascending: false })
      .limit(1);

    if (posts && posts.length) {
      hookSource = posts[0].content;
    } else {
      // Fallback générique si aucun post récent
      hookSource = 'Votre vie numérique mérite d\'être protégée. Découvrez votre Score Cyber.';
    }

    // Permettre de forcer un texte custom en query (utile pour tests)
    if (isManual) {
      const qs = event.queryStringParameters || {};
      if (qs.text) hookSource = qs.text;
    }

    const hook = extractHook(hookSource);
    const pngBuffer = await generateStoryImage(hook);

    // 2. Mode preview : renvoie l'image PNG en base64 (utile pour valider visuellement)
    if (isPreview) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'image/png' },
        body: pngBuffer.toString('base64'),
        isBase64Encoded: true
      };
    }

    // 3. Publication réelle
    const pageId = process.env.FACEBOOK_PAGE_ID;
    const pageToken = await getPageAccessToken(supabase);

    const photoId = await uploadPhoto(pngBuffer, pageId, pageToken);
    const story = await createPhotoStory(photoId, pageId, pageToken);

    // 4. Log
    await supabase.from('social_posts').insert({
      platform: 'facebook',
      post_type: 'story',
      content: hook,
      facebook_post_id: story.post_id || story.id || photoId,
      status: 'published',
      created_at: new Date().toISOString()
    });

    console.log('✅ Story Facebook publiée :', story.post_id || photoId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, photoId, story, hook })
    };

  } catch (err) {
    console.error('❌ story-agent error:', err.message);
    try {
      await supabase.from('social_posts').insert({
        platform: 'facebook',
        post_type: 'story',
        content: '(échec génération)',
        status: 'failed',
        error_message: err.message,
        created_at: new Date().toISOString()
      });
    } catch(e) {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
