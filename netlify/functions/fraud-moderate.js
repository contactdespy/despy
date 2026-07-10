// ════════════════════════════════════════════
// DESPY — Alerte Secteur : modération d'un signalement (garde-fou humain)
// GET ?f=<report_id>&a=<approve|reject>&k=<signature>
//
// Déclenché depuis les boutons de l'email « Signalement à valider »
// (report-fraud.js, cas où la confiance de l'IA est insuffisante).
// - a=approve → status 'approved' → visible sur la carte + alertes
//               temps réel envoyées aux abonnés premium du département
// - a=reject  → status 'rejected' → jamais publié
//
// Liens signés HMAC (même mécanique éprouvée que Privacy Cleanup).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');
const { dispatchFraudAlert, CATEGORIES } = require('./_fraud-alerts');

function page(title, message, color) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Despy</title></head>
<body style="margin:0;background:#f7f9fc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:460px;margin:60px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.08)">
    <div style="background:#010410;padding:22px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="120" style="color:#fff;font-size:22px;font-weight:900;width:120px;height:auto;border:0">
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
  const id = q.f;
  const action = q.a;
  const sig = q.k;

  if (!id || !['approve', 'reject'].includes(action) || !sig) {
    return html(400, page('⚠️ Lien incomplet', 'Ce lien de modération est incomplet. Réessayez depuis l\'email.', '#d97706'));
  }
  if (sig !== signFinding('fraud', id, action)) {
    return html(403, page('🔒 Lien invalide', 'Ce lien de modération n\'est pas valide ou a été modifié.', '#dc2626'));
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // On ne modère que ce qui est encore en attente (idempotent : un 2e clic
    // ne renvoie pas les alertes).
    const { data, error } = await supabase
      .from('fraud_reports')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, reporter_email, category, description, ville, code_postal')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return html(200, page('✓ Déjà traité', 'Ce signalement a déjà été modéré (ou n\'existe plus). Aucun nouvel envoi.', '#6b7280'));
    }

    if (action === 'approve') {
      let alerted = 0;
      try { const r = await dispatchFraudAlert(supabase, data); alerted = r.alerted || 0; }
      catch (e) { console.error('dispatch après approbation:', e.message); }
      return html(200, page(
        '✅ Publié',
        `« ${CATEGORIES[data.category] || data.category} à ${data.ville} » est maintenant visible sur la carte.${alerted ? ` ${alerted} membre(s) premium du département ont été alertés en temps réel.` : ' Aucun abonné premium dans ce département pour le moment.'}`,
        '#16a34a'
      ));
    }

    return html(200, page('🚫 Rejeté', 'Ce signalement ne sera pas publié. Le signaleur n\'est pas notifié.', '#6b7280'));
  } catch (e) {
    console.error('fraud-moderate:', e.message);
    return html(500, page('⚠️ Erreur', 'Une erreur est survenue. Réessayez dans un instant.', '#dc2626'));
  }
};
