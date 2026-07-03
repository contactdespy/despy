// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : agent de scan d'empreinte numérique
// POST interne (x-internal-secret) { user_email, prenom, nom, target_email, phone, ville }
//
// Fonction BACKGROUND Netlify (suffixe -background) : répond 202 tout de
// suite et peut travailler jusqu'à 15 min — un scan complet (8 recherches
// espacées + classification IA) dépasse la limite des fonctions classiques.
//
// Étage 1 (yeux)   : recherches via l'API Brave Search (env : BRAVE_SEARCH_KEY)
//                    — le dernier index indépendant accessible aux développeurs
//                    (Google et Bing ont fermé les leurs en 2025/2026).
// Étage 2 (cerveau): classification de chaque résultat par Claude
//                    (annuaire / réseau social / presse / homonyme / autre)
// Étage 3 (mains)  : stockage privacy_findings + rapport détaillé à l'équipe
//                    (les demandes RGPD annuaires partent déjà via
//                    privacy-dispatch.js ; ici on découvre le RESTE)
//
// Garde-fous : aucune action automatique sur un cas ambigu — l'agent
// découvre et classe, l'humain (ou le client) valide. On ne stocke que
// URL + titre + catégorie (minimisation des données, hébergées en FR).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');

// ── Étage 1 : recherches ──
function buildQueries(c) {
  const queries = new Set();
  const ville = (c.ville || '').trim();
  // Le nom peut être double (usage + naissance) : on cherche chaque combinaison
  const noms = String(c.nom || '').split(/\s+/).filter(n => n.length > 2);
  for (const nom of noms) {
    queries.add(`"${c.prenom} ${nom}"`);
    if (ville) queries.add(`"${c.prenom} ${nom}" ${ville}`);
  }
  if (noms.length > 1) queries.add(`"${c.prenom} ${noms.join(' ')}"`);
  const phone = String(c.phone || '').replace(/\D/g, '');
  if (phone.length === 10) {
    queries.add(`"${phone}"`);
    queries.add(`"${phone.replace(/(\d{2})(?=\d)/g, '$1 ').trim()}"`);
  }
  if (c.target_email) queries.add(`"${c.target_email}"`);
  return [...queries].slice(0, 8); // maîtrise du budget API
}

async function braveSearch(query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=FR&search_lang=fr`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': process.env.BRAVE_SEARCH_KEY
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    console.warn(`Brave "${query}": HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  const items = (data.web && data.web.results) || [];
  return items.map(i => ({ url: i.url, title: i.title || '', snippet: i.description || '', query }));
}

// ── Étage 2 : classification par Claude ──
async function classifyResults(c, results) {
  const list = results.map((r, i) => `${i}. [${r.title}] ${r.url}\n   Extrait: ${r.snippet.slice(0, 180)}\n   (trouvé via: ${r.query})`).join('\n');
  const prompt = `Tu es l'agent Privacy Cleanup de Despy. Un client a demandé l'effacement de son empreinte numérique.

CLIENT : ${c.prenom} ${c.nom}, ville ${c.ville}, email ${c.target_email}, téléphone ${c.phone}.

Voici les résultats de recherche le concernant potentiellement :
${list}

Pour CHAQUE résultat, classe-le. Réponds UNIQUEMENT avec un tableau JSON valide, un objet par résultat :
[{"i": 0, "category": "annuaire|reseau_social|presse_blog|donnees_legales|homonyme_probable|autre", "action": "formulaire|rgpd_email|guide_client|humain|rien", "confidence": 0.0-1.0, "reason": "une phrase courte en français"}]

Règles :
- "annuaire" = annuaire téléphonique / people search / data broker → action formulaire ou rgpd_email
- "reseau_social" = profil du client (Facebook, LinkedIn, Copains d'avant…) → guide_client (lui seul peut agir)
- "presse_blog" = article de presse ou blog → humain (droit à l'oubli, cas par cas)
- "donnees_legales" = registre du commerce, Societe.com, BODACC → humain (suppression partielle seulement)
- "homonyme_probable" = la personne ne semble PAS être le client (autre ville, autre contexte) → rien
- confidence < 0.5 = à faire valider par un humain, ne jamais agir automatiquement`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  const classes = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
  return results.map((r, i) => {
    const cl = classes.find(x => x.i === i) || {};
    return { ...r, category: cl.category || 'autre', action: cl.action || 'humain', confidence: cl.confidence ?? 0, reason: cl.reason || '' };
  });
}

// ── Rapport pour l'équipe (avec boutons de validation par trouvaille) ──
function buildReportHTML(c, findings, queries) {
  const base = process.env.URL || 'https://despy.fr';
  const email = c.user_email.toLowerCase().trim();
  const ICONS = { annuaire: '📒', reseau_social: '📱', presse_blog: '📰', donnees_legales: '⚖️', homonyme_probable: '👤', autre: '❓' };
  const ACTIONS = { formulaire: 'Formulaire de suppression', rgpd_email: 'Demande RGPD par email', guide_client: 'Guider le client (son compte)', humain: 'À évaluer par un humain', rien: 'Rien à faire' };
  const actionable = findings.filter(f => f.action !== 'rien');
  const ignored = findings.filter(f => f.action === 'rien');

  const validationButtons = (f) => {
    if (!f.id) return '<div style="font-size:11px;color:#c00">⚠️ non enregistré (validation SQL manquante ?)</div>';
    const showUrl = `${base}/.netlify/functions/privacy-validate?e=${encodeURIComponent(email)}&f=${f.id}&a=show&k=${signFinding(email, f.id, 'show')}`;
    const ignoreUrl = `${base}/.netlify/functions/privacy-validate?e=${encodeURIComponent(email)}&f=${f.id}&a=ignore&k=${signFinding(email, f.id, 'ignore')}`;
    return `<div style="margin-top:10px">
      <a href="${showUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;margin-right:8px">✅ Afficher au client</a>
      <a href="${ignoreUrl}" style="display:inline-block;background:#eef1f5;color:#555;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700">🚫 Ignorer</a>
    </div>`;
  };

  const row = (f, withButtons) => `
    <div style="padding:14px 16px;border-bottom:1px solid #f0f0f0;font-size:13.5px;line-height:1.6">
      ${ICONS[f.category] || '❓'} <a href="${f.url}" style="color:#2D5BFF;font-weight:600">${(f.title || f.url).slice(0, 80)}</a><br>
      <span style="color:#666">→ <strong>${ACTIONS[f.action] || f.action}</strong> · confiance ${(f.confidence * 100).toFixed(0)}% · ${f.reason}</span>
      ${withButtons ? validationButtons(f) : ''}
    </div>`;

  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;font-size:14px;color:#333">
    <h2 style="color:#0a1f3a">🕵️ Scan d'empreinte — ${c.prenom} ${c.nom} (${c.user_email})</h2>
    <p>${queries.length} recherches effectuées · <strong>${findings.length} résultats analysés</strong> · ${actionable.length} à valider.</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;font-size:13px;color:#1a3fd9;margin:0 0 16px">
      👉 Pour chaque trouvaille : <strong>« Afficher au client »</strong> la rend visible dans son espace Despy · <strong>« Ignorer »</strong> la masque (homonyme, faux positif). Rien n'apparaît chez le client sans votre clic.
    </div>
    ${actionable.length ? `<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:16px 0">
      <div style="background:#0a1f3a;color:#5BE3F5;padding:10px 14px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">À valider</div>
      ${actionable.map(f => row(f, true)).join('')}</div>` : '<p>✅ Rien à traiter — empreinte déjà propre sur ces recherches.</p>'}
    ${ignored.length ? `<details><summary style="cursor:pointer;color:#888;font-size:13px">${ignored.length} résultat(s) écarté(s) automatiquement (homonymes / non pertinents)</summary>
      <div style="border:1px solid #eee;border-radius:12px;overflow:hidden;margin:10px 0">${ignored.map(f => row(f, false)).join('')}</div></details>` : ''}
    <p style="color:#888;font-size:12px;margin-top:18px">Recherche par Brave Search · Les annuaires connus (Solocal, 118218, 118000) ont déjà reçu la demande RGPD via le dispatch automatique.</p>
  </div>`;
}

exports.handler = async (event) => {
  // Fonction background : la réponse HTTP est toujours 202, on garde
  // néanmoins tous les garde-fous internes avant de travailler.
  if (event.httpMethod !== 'POST') return;

  const secret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
  if (!process.env.INTERNAL_SECRET || secret !== process.env.INTERNAL_SECRET) {
    console.warn('privacy-scan: appel non autorisé, ignoré');
    return;
  }
  if (!process.env.BRAVE_SEARCH_KEY) {
    console.warn('privacy-scan: BRAVE_SEARCH_KEY absente — scan inactif');
    return;
  }

  let c = {};
  try { c = JSON.parse(event.body || '{}'); } catch (e) {}
  const required = ['user_email', 'prenom', 'nom', 'target_email', 'phone', 'ville'];
  if (required.some(k => !c[k])) {
    console.warn('privacy-scan: champs manquants, ignoré');
    return;
  }

  try {
    // 1. Recherches (Brave : 1 requête/seconde sur l'offre de base)
    const queries = buildQueries(c);
    const all = [];
    for (const q of queries) {
      all.push(...await braveSearch(q));
      await new Promise(r => setTimeout(r, 1100));
    }
    // Dédoublonnage par URL
    const seen = new Set();
    const unique = all.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0, 30);

    // 2. Classification (si résultats)
    let findings = [];
    if (unique.length > 0) findings = await classifyResults(c, unique);

    // 3. Stockage minimal + récupération de l'id (pour les boutons de validation)
    // status 'found' = pas encore visible du client ; le devient si validé.
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    for (const f of findings) {
      try {
        const { data: inserted } = await supabase.from('privacy_findings').insert({
          user_email: c.user_email.toLowerCase().trim(),
          url: f.url, title: (f.title || '').slice(0, 200),
          category: f.category, action: f.action,
          confidence: f.confidence, reason: (f.reason || '').slice(0, 300),
          status: 'found'
        }).select('id').single();
        if (inserted) f.id = inserted.id;
      } catch (e) { console.warn('finding insert:', e.message); }
    }

    // 4. Rapport à l'équipe
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Despy — Agent Privacy <contact@despy.fr>',
          to: ['contact.despy@gmail.com'],
          subject: `🕵️ Scan ${c.prenom} ${c.nom} : ${findings.filter(f => f.action !== 'rien').length} action(s) sur ${findings.length} résultat(s)`,
          html: buildReportHTML(c, findings, queries)
        })
      });
    } catch (e) { console.error('rapport scan:', e.message); }

    console.log(`Scan ${c.user_email}: ${queries.length} requêtes, ${findings.length} résultats`);
  } catch (err) {
    console.error('privacy-scan error:', err.message);
  }
};
