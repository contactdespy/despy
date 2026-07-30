// ════════════════════════════════════════════
// DESPY — « L'arnaque du mois » : génère le module de formation du mois
// Cron le 1er du mois (voir netlify.toml).
//
// Principe : la formation en 10 modules est FINIE — une fois terminée, le
// client n'a plus de raison de revenir. Les arnaques, elles, changent tous
// les mois. Ce cron transforme la matière première déjà collectée par Despy
// (alertes nationales + signalements réels des membres) en un module court.
//
// SÉCURITÉ ÉDITORIALE : le module est créé en `draft` et n'est JAMAIS visible
// des clients tant qu'un humain n'a pas cliqué « Publier » dans l'email.
// On ne diffuse pas des conseils de sécurité générés par IA à des personnes
// âgées sans relecture.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { isScheduled, notScheduled } = require('./_is-scheduled');
const { signModule } = require('./_monthly-sign');

const VALIDATEUR = process.env.ADMIN_EMAIL || 'contact.despy@gmail.com';

const CONSIGNE = `Tu prépares un court module de formation anti-arnaque pour Despy,
destiné à des particuliers français, souvent des personnes âgées.

RÈGLES DE FOND
- Base-toi UNIQUEMENT sur les arnaques listées ci-dessous (faits réels du mois).
- 4 questions à choix multiples, 3 options chacune.
- Les 3 options doivent être PLAUSIBLES : la mauvaise réponse doit être une erreur
  que les gens commettent vraiment, jamais une bêtise caricaturale.
- Au moins UNE question où la bonne réponse est « c'est légitime » ou demande de
  distinguer un vrai message d'un faux : on apprend à discriminer, pas à tout rejeter.
- Explications de 2 à 4 phrases, en langage simple, sans jargon, ton bienveillant
  et jamais culpabilisant. Vouvoiement.
- Aucun conseil qui pourrait faire rater un appel médical ou un service public.
- Numéros utiles autorisés : 33700 (SMS), 17, 0 892 705 705 (opposition carte),
  0 805 805 817 (Info Escroqueries). N'invente JAMAIS d'autre numéro ni d'URL.

FORMAT — réponds UNIQUEMENT avec ce JSON, rien d'autre :
{
  "title": "titre court du module (max 55 caractères)",
  "intro": "2 phrases qui expliquent ce qu'on va apprendre",
  "questions": [
    { "q": "...", "opts": ["...","...","..."], "answer": 0, "expl": "..." }
  ]
}`;

async function genererModule(matiere) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: CONSIGNE + '\n\nARNAQUES DU MOIS :\n' + matiere }]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) throw new Error('Anthropic ' + r.status);
  const data = await r.json();
  const texte = (data.content && data.content[0] && data.content[0].text) || '';
  const m = texte.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('reponse illisible');
  return JSON.parse(m[0]);
}

// Garde-fou : on ne publie rien qui ne respecte pas la structure attendue.
function moduleValide(mod) {
  if (!mod || typeof mod.title !== 'string' || !Array.isArray(mod.questions)) return false;
  if (mod.questions.length < 3 || mod.questions.length > 6) return false;
  return mod.questions.every(q =>
    q && typeof q.q === 'string' && q.q.length > 10 &&
    Array.isArray(q.opts) && q.opts.length === 3 &&
    q.opts.every(o => typeof o === 'string' && o.length > 0) &&
    Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 2 &&
    typeof q.expl === 'string' && q.expl.length > 20
  );
}

exports.handler = async (event) => {
  if (!isScheduled(event)) return notScheduled();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const periode = new Date().toISOString().slice(0, 7);

  try {
    // Déjà un module pour ce mois ? on ne double pas.
    const { data: deja } = await supabase
      .from('monthly_modules').select('id, status').eq('period', periode).maybeSingle();
    if (deja) {
      console.log('module du mois deja present', periode, deja.status);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'deja_genere', period: periode }) };
    }

    // ── Matière première : ce que Despy a réellement observé ce mois-ci ──
    const depuis = new Date(Date.now() - 45 * 86400000).toISOString();
    const morceaux = [];
    const sources = { alertes: 0, signalements: 0 };

    try {
      const { data: al } = await supabase
        .from('national_alerts').select('title, body, created_at')
        .gte('created_at', depuis).order('created_at', { ascending: false }).limit(12);
      (al || []).forEach(a => {
        morceaux.push('- ALERTE NATIONALE : ' + a.title + (a.body ? ' — ' + String(a.body).slice(0, 300) : ''));
        sources.alertes++;
      });
    } catch (e) { console.warn('alertes:', e.message); }

    try {
      const { data: fr } = await supabase
        .from('fraud_reports').select('category, description, ville, created_at')
        .eq('status', 'published').gte('created_at', depuis)
        .order('created_at', { ascending: false }).limit(20);
      (fr || []).forEach(f => {
        morceaux.push('- SIGNALEMENT MEMBRE (' + (f.category || 'autre') + ', ' + (f.ville || 'France') + ') : ' +
                      String(f.description || '').slice(0, 250));
        sources.signalements++;
      });
    } catch (e) { console.warn('signalements:', e.message); }

    // Pas assez de matière réelle → on ne fabrique pas du vide.
    if (morceaux.length < 3) {
      console.log('pas assez de matiere ce mois-ci (', morceaux.length, ')');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'matiere_insuffisante', found: morceaux.length }) };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'pas_de_cle_ia' }) };
    }

    const mod = await genererModule(morceaux.join('\n'));
    if (!moduleValide(mod)) {
      console.error('module genere invalide, abandon');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'format_invalide' }) };
    }

    const { data: ligne, error } = await supabase.from('monthly_modules').insert({
      period: periode,
      title: String(mod.title).slice(0, 80),
      intro: String(mod.intro || '').slice(0, 400),
      questions: mod.questions,
      sources,
      status: 'draft'
    }).select('id').single();
    if (error) throw new Error('insert: ' + error.message);

    // ── Email de validation (rien n'est publié sans ce clic) ──
    const base = process.env.URL || 'https://despy.fr';
    const lienPub = `${base}/.netlify/functions/training-validate?id=${ligne.id}&action=publish&sig=${signModule(ligne.id, 'publish')}`;
    const lienRej = `${base}/.netlify/functions/training-validate?id=${ligne.id}&action=reject&sig=${signModule(ligne.id, 'reject')}`;

    const apercu = mod.questions.map((q, i) =>
      `<div style="border:1px solid #E7EBF3;border-radius:12px;padding:14px;margin-bottom:10px">
         <div style="font-weight:800;color:#0f1830;margin-bottom:8px">${i + 1}. ${q.q}</div>
         ${q.opts.map((o, n) => `<div style="font-size:14px;color:${n === q.answer ? '#15803D' : '#6b7280'};margin-bottom:4px">
            ${n === q.answer ? '✓' : '•'} ${o}</div>`).join('')}
         <div style="font-size:13px;color:#374151;background:#F6F8FC;border-radius:9px;padding:10px;margin-top:8px">${q.expl}</div>
       </div>`).join('');

    await fetch(`${base}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({
        type: 'custom',
        data: {
          email: VALIDATEUR,
          subject: `📚 Despy — Module du mois à valider : ${mod.title}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff">
              <div style="background:#010410;padding:16px 28px;text-align:center">
                <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="100" style="color:#fff;font-size:22px;font-weight:900;width:100px;max-width:42%;height:auto;display:inline-block;border:0">
              </div>
              <div style="background:#2D5BFF;padding:22px 28px;color:#fff">
                <div style="font-size:11px;font-weight:700;opacity:.85;letter-spacing:2px">MODULE DU MOIS — ${periode}</div>
                <div style="font-size:21px;font-weight:800;margin-top:6px">${mod.title}</div>
              </div>
              <div style="padding:24px 28px">
                <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 6px">${mod.intro || ''}</p>
                <p style="font-size:13px;color:#6b7280;margin:0 0 18px">Généré à partir de ${sources.alertes} alerte(s) nationale(s) et ${sources.signalements} signalement(s) de membres.</p>
                ${apercu}
                <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:18px 0 12px">
                  Rien n'est visible des clients tant que vous n'avez pas cliqué. Relisez : la bonne réponse est marquée ✓.
                </p>
                <a href="${lienPub}" style="display:block;background:#15803D;color:#fff;text-decoration:none;text-align:center;padding:15px;border-radius:12px;font-weight:800;margin-bottom:10px">✅ Publier ce module</a>
                <a href="${lienRej}" style="display:block;background:#fff;color:#991b1b;border:1px solid #f0c4c4;text-decoration:none;text-align:center;padding:15px;border-radius:12px;font-weight:800">🚫 Rejeter</a>
              </div>
            </div>`
        }
      })
    });

    console.log('module du mois genere', periode, 'id', ligne.id);
    return { statusCode: 200, body: JSON.stringify({ created: ligne.id, period: periode, status: 'draft', sources }) };
  } catch (err) {
    console.error('monthly-training:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
