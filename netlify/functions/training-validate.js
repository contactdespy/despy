// ════════════════════════════════════════════
// DESPY — Validation humaine du module du mois (boutons de l'email)
// GET ?id=..&action=publish|reject&sig=..
//
// Tant que personne n'a cliqué « Publier », le module reste en `draft` et
// n'est jamais servi aux clients. Idempotent : recliquer ne casse rien.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signModule } = require('./_monthly-sign');

function page(titre, message, couleur) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Despy</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#F4F6FB;padding:40px 18px">
  <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(12,25,55,.10)">
    <div style="background:${couleur};padding:26px 28px;color:#fff">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;opacity:.85">DESPY — MODULE DU MOIS</div>
      <div style="font-size:22px;font-weight:800;margin-top:6px">${titre}</div>
    </div>
    <div style="padding:26px 28px;font-size:15.5px;line-height:1.6;color:#374151">${message}</div>
  </div>
</body></html>`;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  const q = event.queryStringParameters || {};
  const id = q.id, action = q.action, sig = q.sig;

  if (!id || !action || !sig || !['publish', 'reject'].includes(action)) {
    return { statusCode: 400, headers, body: page('Lien invalide', 'Ce lien est incomplet. Rouvrez l’email de validation.', '#991b1b') };
  }
  if (sig !== signModule(id, action)) {
    return { statusCode: 403, headers, body: page('Lien non valide', 'Cette signature ne correspond pas. Par sécurité, l’opération est refusée.', '#991b1b') };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: mod } = await supabase
      .from('monthly_modules').select('id, title, period, status').eq('id', id).maybeSingle();
    if (!mod) {
      return { statusCode: 404, headers, body: page('Introuvable', 'Ce module n’existe plus.', '#991b1b') };
    }

    // Idempotent : on n'écrase pas une décision déjà prise.
    if (mod.status !== 'draft') {
      const dit = mod.status === 'published' ? 'déjà publié' : 'déjà rejeté';
      return { statusCode: 200, headers, body: page('C’était déjà fait',
        `Le module « ${mod.title} » (${mod.period}) est ${dit}. Aucune action supplémentaire n’a été effectuée.`, '#6b7280') };
    }

    if (action === 'publish') {
      await supabase.from('monthly_modules')
        .update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id);
      return { statusCode: 200, headers, body: page('Module publié ✅',
        `« ${mod.title} » est maintenant visible dans l’appli, dans la formation, pour les abonnés. Il remplacera automatiquement le module du mois précédent.`, '#15803D') };
    }

    await supabase.from('monthly_modules').update({ status: 'rejected' }).eq('id', id);
    return { statusCode: 200, headers, body: page('Module rejeté',
      `« ${mod.title} » ne sera pas publié. Les clients ne verront rien. Un nouveau module sera proposé le 1er du mois prochain.`, '#B4892E') };
  } catch (err) {
    console.error('training-validate:', err.message);
    return { statusCode: 500, headers, body: page('Erreur', 'Impossible de traiter la demande pour le moment.', '#991b1b') };
  }
};
