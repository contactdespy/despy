// ════════════════════════════════════════════
// DESPY — Validation d'une trouvaille Privacy Cleanup (garde-fou humain)
// GET ?e=<email>&f=<finding_id>&a=<show|ignore>&k=<signature>
//
// Déclenché depuis les boutons de l'email de rapport de scan. Rien n'est
// visible par le client tant qu'une trouvaille n'est pas « validée » ici :
// - a=show   → status 'validated' → apparaît dans l'espace du client
// - a=ignore → status 'ignored'   → jamais affiché (homonyme, doublon…)
//
// Répond une page de confirmation sobre et rassurante (l'équipe clique
// depuis sa boîte mail, ce n'est pas une page publique).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');

function page(title, message, color) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Despy</title></head>
<body style="margin:0;background:#f7f9fc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:460px;margin:60px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.08)">
    <div style="background:#010410;padding:22px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="120" style="width:120px;height:auto;border:0">
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF)"></div>
    <div style="padding:34px 30px;text-align:center">
      <div style="width:56px;height:56px;border-radius:50%;background:${color};margin:0 auto 18px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px">${title.slice(0, 2)}</div>
      <div style="font-size:19px;font-weight:800;color:#0a1f3a;margin-bottom:8px">${title.slice(2).trim()}</div>
      <p style="font-size:14.5px;color:#555;line-height:1.6;margin:0">${message}</p>
      <p style="font-size:12px;color:#aaa;margin-top:24px">Vous pouvez fermer cette page.</p>
    </div>
  </div>
</body></html>`;
}

exports.handler = async (event) => {
  const html = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body });
  const q = event.queryStringParameters || {};
  const email = (q.e || '').toLowerCase().trim();
  const id = q.f;
  const action = q.a;
  const sig = q.k;

  if (!email || !id || !['show', 'ignore'].includes(action) || !sig) {
    return html(400, page('⚠️ Lien incomplet', 'Ce lien de validation est incomplet. Réessayez depuis l\'email de rapport.', '#d97706'));
  }
  if (sig !== signFinding(email, id, action)) {
    return html(403, page('🔒 Lien invalide', 'Ce lien de validation n\'est pas valide ou a été modifié.', '#dc2626'));
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const newStatus = action === 'show' ? 'validated' : 'ignored';
    const { data, error } = await supabase
      .from('privacy_findings')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('user_email', email)
      .select('title')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return html(404, page('❓ Introuvable', 'Cette trouvaille n\'existe plus ou a déjà été traitée.', '#6b7280'));
    }

    const shortTitle = (data.title || 'la trouvaille').slice(0, 70);
    if (action === 'show') {
      return html(200, page('✅ Affiché au client', `« ${shortTitle} » est maintenant visible dans l'espace du client, avec son statut de suivi.`, '#16a34a'));
    }
    return html(200, page('🚫 Ignoré', `« ${shortTitle} » restera masqué : le client ne le verra pas. Parfait pour les homonymes ou faux positifs.`, '#6b7280'));
  } catch (e) {
    console.error('privacy-validate:', e.message);
    return html(500, page('⚠️ Erreur', 'Une erreur est survenue. Réessayez dans un instant.', '#dc2626'));
  }
};
