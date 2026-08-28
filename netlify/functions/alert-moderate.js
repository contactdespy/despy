// ════════════════════════════════════════════
// DESPY — Veille presse : publier ou rejeter un article
// GET ?a=<id>&d=<publier|rejeter>&k=<signature>
//
// Cliqué depuis les boutons du récapitulatif (_presse-recap.js). Rien d'autre
// ne fait passer un article de presse de la file d'attente à l'application.
//
// Même mécanique que fraud-moderate.js : lien signé HMAC, mise à jour
// conditionnée au statut 'a_valider' pour rester idempotent — un deuxième clic
// (email transféré, lien préchargé par le client mail) ne doit rien changer
// ni faire croire à une erreur.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');

function page(titre, message, couleur, badge) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${titre} — Despy</title></head>
<body style="margin:0;background:#f7f9fc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:460px;margin:60px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.08)">
    <div style="background:#010410;padding:22px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="120" style="width:120px;height:auto;border:0">
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF)"></div>
    <div style="padding:34px 30px;text-align:center">
      <div style="width:56px;height:56px;line-height:56px;border-radius:50%;background:${couleur};margin:0 auto 18px;color:#fff;font-size:26px">${badge}</div>
      <div style="font-size:19px;font-weight:800;color:#0a1f3a;margin-bottom:8px">${titre}</div>
      <p style="font-size:14.5px;color:#555;line-height:1.6;margin:0">${message}</p>
      <p style="font-size:12px;color:#aaa;margin-top:24px">Vous pouvez fermer cette page.</p>
    </div>
  </div>
</body></html>`;
}

exports.handler = async (event) => {
  const html = (code, body) => ({
    statusCode: code,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body
  });

  const q = event.queryStringParameters || {};
  const id = q.a;
  const decision = q.d;
  const sig = q.k;

  if (!id || ['publier', 'rejeter'].indexOf(decision) === -1 || !sig) {
    return html(400, page('Lien incomplet',
      'Ce lien de validation est incomplet. Réessayez depuis l\'email.', '#d97706', '⚠️'));
  }
  if (sig !== signFinding('alerte', id, decision)) {
    return html(403, page('Lien invalide',
      'Ce lien de validation n\'est pas valide ou a été modifié.', '#dc2626', '🔒'));
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // `.eq('status', 'a_valider')` fait tout le travail d'idempotence : la
    // deuxième requête ne trouve plus rien à modifier et ne peut donc pas
    // republier ni « dé-publier » quoi que ce soit.
    const { data, error } = await supabase
      .from('national_alerts')
      .update({ status: decision === 'publier' ? 'publie' : 'rejete' })
      .eq('id', id)
      .eq('status', 'a_valider')
      .select('id, title, source')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return html(200, page('Déjà traité',
        'Cet article a déjà été validé ou rejeté. Rien n\'a été modifié.', '#6b7280', '✓'));
    }

    if (decision === 'publier') {
      return html(200, page('Publié',
        `« ${data.title} » est maintenant visible dans l'application et sur le site.`
        + ' Aucune notification n\'a été envoyée : la presse ne réveille personne.',
        '#16a34a', '✅'));
    }

    return html(200, page('Rejeté',
      `« ${data.title} » ne sera pas publié, et ne vous sera plus reproposé.`,
      '#6b7280', '🚫'));

  } catch (e) {
    console.error('[alert-moderate]', e && e.message);
    return html(500, page('Erreur',
      'Une erreur est survenue. Réessayez dans un instant.', '#dc2626', '⚠️'));
  }
};
