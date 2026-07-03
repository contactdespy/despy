// ════════════════════════════════════════════
// DESPY — Réponse du CLIENT à une consultation Privacy Cleanup
// GET ?e=<email>&f=<finding_id>&r=<yes|no>&k=<signature>
//
// Déclenché quand le client clique « Oui c'est moi » / « Non ce n'est pas
// moi » dans l'email de consultation (cas ambigus repérés au scan).
// - r=yes → status 'validated' → visible dans son espace + on prévient
//           l'équipe pour envoyer la demande de suppression.
// - r=no  → status 'ignored'  → on n'y touche plus (numéro d'un ancien
//           titulaire, homonyme…).
//
// Page de confirmation chaleureuse : c'est un senior qui la lit.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');

function page(emoji, title, message) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Despy</title></head>
<body style="margin:0;background:#f7f9fc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:50px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.08)">
    <div style="background:#010410;padding:24px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="color:#fff;font-size:22px;font-weight:900;width:130px;height:auto;border:0">
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF)"></div>
    <div style="padding:38px 32px;text-align:center">
      <div style="font-size:52px;margin-bottom:14px">${emoji}</div>
      <div style="font-size:21px;font-weight:800;color:#0a1f3a;margin-bottom:12px">${title}</div>
      <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 20px">${message}</p>
      <a href="https://despy.fr" style="display:inline-block;background:#2D5BFF;color:#fff;text-decoration:none;padding:13px 30px;border-radius:10px;font-weight:700;font-size:15px">Voir mon espace Despy</a>
    </div>
    <div style="padding:16px;text-align:center;font-size:12px;color:#aaa;background:#fafbfc">Merci pour votre confiance · despy.fr</div>
  </div>
</body></html>`;
}

exports.handler = async (event) => {
  const html = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body });
  const q = event.queryStringParameters || {};
  const email = (q.e || '').toLowerCase().trim();
  const id = q.f;
  const resp = q.r; // 'yes' | 'no'
  const sig = q.k;

  if (!email || !id || !['yes', 'no'].includes(resp) || !sig) {
    return html(400, page('⚠️', 'Lien incomplet', 'Ce lien de confirmation est incomplet. Rouvrez l\'email que nous vous avons envoyé et cliquez à nouveau.'));
  }
  const expected = signFinding(email, id, resp === 'yes' ? 'cyes' : 'cno');
  if (sig !== expected) {
    return html(403, page('🔒', 'Lien invalide', 'Ce lien n\'est pas valide. Rouvrez l\'email d\'origine et cliquez sur le bouton directement.'));
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const newStatus = resp === 'yes' ? 'validated' : 'ignored';
    const { data, error } = await supabase
      .from('privacy_findings')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('user_email', email)
      .select('title, url')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return html(200, page('✓', 'Déjà enregistré', 'Votre réponse a bien été prise en compte. Merci&nbsp;!'));
    }

    if (resp === 'yes') {
      // Prévenir l'équipe pour lancer la demande de suppression de ce site précis.
      let host = '';
      try { host = new URL(data.url).hostname.replace(/^www\./, ''); } catch (e) {}
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Despy — Agent Privacy <contact@despy.fr>',
            to: ['contact.despy@gmail.com'],
            subject: `✅ ${email} a confirmé : c'est bien elle/lui — supprimer sur ${host || 'le site'}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.7">
              <p>Le client <strong>${email}</strong> a confirmé que la fiche suivante est bien la sienne :</p>
              <p>📒 <a href="${data.url}">${(data.title || data.url).slice(0, 90)}</a></p>
              <p>→ <strong>Action :</strong> envoyer la demande d'effacement RGPD à ${host || 'ce site'} (gabarit dans scripts/privacy/template-rgpd-art17.md), centrée sur le <strong>numéro de téléphone</strong>. La fiche est déjà visible dans l'espace du client (statut « en cours »).</p>
            </div>`
          })
        });
      } catch (e) { console.error('notif équipe confirm:', e.message); }

      return html(200, page('✅', 'Merci, c\'est noté&nbsp;!', 'Nous allons demander la suppression de vos informations sur ce site. Vous pouvez suivre l\'avancement dans votre espace Despy — nous nous occupons de tout.'));
    }

    return html(200, page('👍', 'Parfait, merci&nbsp;!', 'Ce n\'était pas vous&nbsp;: nous laissons donc cette information de côté. Rien d\'autre à faire — votre nettoyage continue en arrière-plan.'));
  } catch (e) {
    console.error('privacy-confirm:', e.message);
    return html(500, page('⚠️', 'Petit souci technique', 'Réessayez dans un instant, ou écrivez-nous à contact@despy.fr et nous le ferons pour vous.'));
  }
};
