// ════════════════════════════════════════════
// DESPY — Progression de la formation (modules + quiz)
//
// Deux défauts que cette fonction corrige :
//
// 1. L'étape 4 de la checklist Protection (« Faire votre premier quiz ») lit
//    `quizzes_completed`, que SEUL le Défi Chrono incrémentait. Ni le quiz
//    ordinaire ni les modules ne signalaient quoi que ce soit : faire le quiz
//    vers lequel l'étape pointe ne la cochait donc jamais. Même schéma que
//    l'étape « personne de confiance », corrigée le 2026-08-05.
//
// 2. La progression des 10 modules ne vivait QUE dans le localStorage du
//    téléphone (`despy_module_1..10`). Changement d'appareil, cache vidé, ou
//    passage par le site : tout était perdu, sans prévenir. Pour un abonné
//    qui a fait 7 modules, c'est sa formation qui disparaît.
//
// Les modules faits sont stockés en TEXTE (« 1,3,7 ») plutôt qu'en tableau :
// une colonne simple, lisible, et fusionnable sans risque avec l'état local.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth, rateLimit } = require('./_auth');

const MODULE_MAX = 10;

function listeVersTexte(ids) {
  return Array.from(new Set(ids))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= MODULE_MAX)
    .sort((a, b) => a - b)
    .join(',');
}
function texteVersListe(t) {
  return String(t || '').split(',')
    .map(n => parseInt(n, 10))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= MODULE_MAX);
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!rateLimit(event, 'formation', 60, 10 * 60 * 1000)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Trop de requêtes.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }
    const auth = requireAuth(event, body, email, headers);
    if (auth) return auth;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // La colonne peut manquer si la migration n'est pas passée : on dégrade
    // au lieu de casser la formation.
    let avecModules = true;
    let res = await supabase.from('clients')
      .select('quizzes_completed, modules_done').eq('email', email).maybeSingle();
    if (res.error) {
      avecModules = false;
      res = await supabase.from('clients')
        .select('quizzes_completed').eq('email', email).maybeSingle();
    }
    if (res.error || !res.data) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Compte introuvable' }) };
    }
    const client = res.data;
    const faits = avecModules ? texteVersListe(client.modules_done) : [];

    // ── Lecture seule ──
    if (!body.action || body.action === 'etat') {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          modules: faits,
          quizzes_completed: client.quizzes_completed || 0,
          disponible: avecModules
        })
      };
    }

    const patch = { updated_at: new Date().toISOString() };
    let modules = faits;

    if (body.action === 'module') {
      const id = parseInt(body.id, 10);
      if (!Number.isInteger(id) || id < 1 || id > MODULE_MAX) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Module inconnu' }) };
      }
      // Un module déjà fait ne recompte pas : sinon le score gonflerait à
      // chaque relecture, ce qui est justement ce qu'on encourage.
      if (faits.indexOf(id) === -1) {
        modules = faits.concat([id]);
        if (avecModules) patch.modules_done = listeVersTexte(modules);
        patch.quizzes_completed = (client.quizzes_completed || 0) + 1;
      }
    } else if (body.action === 'quiz') {
      patch.quizzes_completed = (client.quizzes_completed || 0) + 1;
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue' }) };
    }

    // Fusion : on n'écrase jamais ce que le client a déjà fait ailleurs.
    if (body.action === 'module' && Array.isArray(body.locaux) && avecModules) {
      const union = modules.concat(
        body.locaux.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n))
      );
      patch.modules_done = listeVersTexte(union);
      modules = texteVersListe(patch.modules_done);
    }

    const { error: eMaj } = await supabase.from('clients').update(patch).eq('email', email);
    if (eMaj) {
      delete patch.modules_done;
      await supabase.from('clients').update(patch).eq('email', email);
      console.warn('formation-progress (repli sans modules_done):', eMaj.message);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ok: true,
        modules,
        quizzes_completed: patch.quizzes_completed !== undefined
          ? patch.quizzes_completed : (client.quizzes_completed || 0)
      })
    };

  } catch (err) {
    console.error('formation-progress:', err && err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
