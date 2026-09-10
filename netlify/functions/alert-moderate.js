// ════════════════════════════════════════════
// DESPY — Veille presse : publier, prévenir, ou rejeter un article
// GET ?a=<id>&d=<publier|publier_prevenir|rejeter>&k=<signature>
//
// Cliqué depuis les boutons du récapitulatif (_presse-recap.js). Rien d'autre
// ne fait passer un article de presse de la file d'attente à l'application.
//
// Trois décisions, dont deux publient :
//   • publier          → visible dans l'appli. Personne n'est prévenu.
//   • publier_prevenir → visible, ET un email de prévention part à tout le
//                        fichier, plus une notification. Le seul chemin par
//                        lequel un article de presse écrit à un client.
//   • rejeter          → rien, et ne sera plus reproposé.
//
// Le silence reste le comportement par défaut : « publier » ne réveille
// personne, comme avant. Prévenir est un geste distinct, qu'on pose article
// par article — parce qu'écrire à tout le fichier pour un fait divers, c'est
// la meilleure façon de n'être plus lu le jour où ça compte.
//
// Chaque décision a sa PROPRE signature : un lien « publier » ne peut pas
// être transformé en « publier et prévenir » en changeant un mot dans l'URL.
//
// Même mécanique que fraud-moderate.js : lien signé HMAC, mise à jour
// conditionnée au statut 'a_valider' pour rester idempotent — un deuxième clic
// (email transféré, lien préchargé par le client mail) ne doit rien changer
// ni faire croire à une erreur.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');

// Une décision → le statut qu'elle écrit. Explicite plutôt qu'un ternaire :
// avec trois valeurs dont deux publient, « tout ce qui n'est pas publier est
// un rejet » deviendrait faux au premier ajout.
const STATUT = {
  publier:          'publie',
  publier_prevenir: 'publie',
  rejeter:          'rejete'
};

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

  if (!id || !Object.prototype.hasOwnProperty.call(STATUT, decision) || !sig) {
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
      .update({ status: STATUT[decision] })
      .eq('id', id)
      .eq('status', 'a_valider')
      .select('id, title, source')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return html(200, page('Déjà traité',
        'Cet article a déjà été validé ou rejeté. Rien n\'a été modifié.', '#6b7280', '✓'));
    }

    if (decision === 'publier_prevenir') {
      // Fonction background : elle répond 202 immédiatement et travaille
      // ensuite jusqu'à 15 min (rédaction du contenu puis envois espacés).
      // On n'attend donc pas le résultat — la page doit s'afficher tout de
      // suite, et le compte rendu détaillé arrive par email.
      let lance = true;
      try {
        const r = await fetch(`${process.env.URL || 'https://despy.fr'}/.netlify/functions/alerte-prevention-background`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({ alert_id: data.id }),
          signal: AbortSignal.timeout(8000)
        });
        // 202 = accepté, le travail commence. Tout autre code veut dire que
        // rien ne partira, et l'administrateur doit le savoir MAINTENANT :
        // sinon il repart convaincu que ses clients ont été prévenus.
        if (!r.ok && r.status !== 202) {
          lance = false;
          console.error('[alert-moderate] prévention refusée : HTTP', r.status);
        }
      } catch (e) {
        lance = false;
        console.error('[alert-moderate] prévention non lancée :', e && e.message);
      }

      if (!lance) {
        return html(200, page('Publié, mais non envoyé',
          `« ${data.title} » est bien visible dans l'application.`
          + ' En revanche l\'email de prévention n\'a pas pu être lancé —'
          + ' <strong>personne n\'a été prévenu</strong>. Réessayez dans quelques'
          + ' minutes depuis le récapitulatif, ou consultez les journaux Netlify.',
          '#d97706', '⚠️'));
      }

      return html(200, page('Publié et prévention en cours',
        `« ${data.title} » est visible dans l'application.`
        + ' L\'email de prévention est en cours de rédaction, puis partira aux'
        + ' abonnés et aux comptes gratuits, avec une notification.'
        + '<br><br>Vous recevrez un <strong>compte rendu par email</strong> :'
        + ' combien de personnes ont été prévenues — ou, si le contenu n\'a pas'
        + ' pu être préparé, pourquoi rien n\'a été envoyé.',
        '#2D5BFF', '📣'));
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
