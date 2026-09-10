// ════════════════════════════════════════════
// DESPY — « Publier et prévenir » : la partie qui prévient vraiment
// POST interne (x-internal-secret) { alert_id }
//
// Déclenché par alert-moderate.js quand l'administrateur choisit le troisième
// bouton du récapitulatif de veille. Jamais par un cron : personne ne reçoit
// cet email sans qu'un humain l'ait décidé, article par article.
//
// Fonction BACKGROUND (suffixe -background) : répond 202 tout de suite et
// travaille jusqu'à 15 min. C'est nécessaire — la rédaction du contenu prend
// une dizaine de secondes, puis chaque email est espacé pour ne pas se faire
// classer en spam par Gmail. Une fonction classique (10 s) serait coupée en
// plein envoi, laissant la moitié du fichier prévenue et l'autre non.
//
// Ordre volontaire des étapes :
//   1. lire l'article
//   2. vérifier qu'il n'a pas déjà été diffusé   → sinon on s'arrête
//   3. RÉDIGER le contenu de prévention          → si ça échoue, on n'envoie
//      rien du tout et on prévient l'administrateur : un email de prévention
//      sans prévention, c'est le relais de presse qu'on voulait éviter
//   4. réserver la place dans sent_alerts        → avant l'envoi, pour qu'un
//      rejeu ne puisse pas écrire deux fois aux mêmes personnes
//   5. envoyer, notifier, faire le compte rendu
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { preparerPrevention } = require('./_alerte-prevention');
const { envoyerPush, tagDepuis } = require('./_push');

const ADMIN = process.env.ALERTES_MODERATION_EMAIL || 'contact.despy@gmail.com';

// Gmail et Outlook regardent le débit. 250 ms entre deux messages, c'est
// quatre par seconde : invisible sur un fichier de quelques centaines
// d'adresses, et bien en dessous de ce qui déclenche un filtrage.
const PAUSE_MS = 250;

const base = () => process.env.URL || 'https://despy.fr';

async function envoyerEmail(type, data) {
  const res = await fetch(`${base()}/.netlify/functions/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_SECRET || ''
    },
    body: JSON.stringify({ type, data }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`send-email HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// Compte rendu à l'administrateur. C'est le seul retour qu'il aura : la page
// de confirmation, elle, est rendue avant que le moindre email soit parti.
async function rapport(sujet, corpsHtml) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Despy — Veille <contact@despy.fr>',
        to: [ADMIN],
        subject: sujet,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#333;max-width:620px;margin:0 auto;font-size:14px;line-height:1.65">${corpsHtml}</div>`
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    console.error('[prevention] compte rendu non envoyé:', e && e.message);
  }
}

function echapper(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Les destinataires, séparés en deux listes. Les désinscrits (email_optouts)
// sont écartés des DEUX : une alerte reste un email, et quelqu'un qui a cliqué
// « me désinscrire » a dit non à nos emails, pas seulement au conseil du lundi.
async function destinataires(supabase) {
  const optout = new Set();
  try {
    const { data: outs } = await supabase.from('email_optouts').select('email');
    (outs || []).forEach(o => optout.add((o.email || '').toLowerCase().trim()));
  } catch (e) { console.warn('[prevention] email_optouts illisible:', e && e.message); }

  const { data: clients, error } = await supabase
    .from('clients')
    .select('email, name, prenom, subscribed');
  if (error) throw new Error('clients illisible : ' + error.message);

  const abonnes = [], gratuits = [];
  for (const c of (clients || [])) {
    const mail = (c.email || '').toLowerCase().trim();
    if (!mail || !mail.includes('@') || optout.has(mail)) continue;
    (c.subscribed ? abonnes : gratuits).push({
      email: mail,
      prenom: c.prenom || (c.name || '').split(' ')[0] || ''
    });
  }
  return { abonnes, gratuits, desinscrits: optout.size };
}

async function diffuser(liste, type, contenu, alerte) {
  let envoyes = 0;
  const echecs = [];
  for (const client of liste) {
    try {
      await envoyerEmail(type, {
        email: client.email,
        prenom: client.prenom,
        contenu,
        alertSource: alerte.source,
        alertLink: alerte.url
      });
      envoyes++;
    } catch (e) {
      echecs.push(client.email);
      console.error('[prevention] envoi impossible', client.email, e && e.message);
    }
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  return { envoyes, echecs };
}

exports.handler = async (event) => {
  const ok = (obj) => ({ statusCode: 200, body: JSON.stringify(obj) });

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '{}' };

  const secret = process.env.INTERNAL_SECRET;
  if (secret && event.headers['x-internal-secret'] !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Accès non autorisé' }) };
  }

  let alertId;
  try { alertId = JSON.parse(event.body || '{}').alert_id; } catch (e) {}
  if (!alertId) return { statusCode: 400, body: JSON.stringify({ error: 'alert_id requis' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. L'article
    const { data: alerte, error: eLecture } = await supabase
      .from('national_alerts')
      .select('id, title, body, source, url')
      .eq('id', alertId)
      .maybeSingle();

    if (eLecture) throw new Error('lecture article : ' + eLecture.message);
    if (!alerte) {
      console.error('[prevention] article introuvable :', alertId);
      return ok({ erreur: 'article_introuvable' });
    }

    // Clé de diffusion. Un article de presse a toujours une URL, mais une
    // fiche interne pourrait ne pas en avoir : on retombe alors sur son id,
    // qui est tout aussi unique.
    const cle = alerte.url || `despy:alerte:${alerte.id}`;

    // 2. Déjà diffusé ? Deux clics sur le même bouton (email transféré, lien
    //    préchargé par le client mail) ne doivent pas écrire deux fois.
    const { data: deja } = await supabase
      .from('sent_alerts').select('id').eq('alert_url', cle).maybeSingle();
    if (deja) {
      console.log('[prevention] déjà diffusé, on ne renvoie pas :', alerte.title);
      return ok({ ignore: 'deja_diffuse' });
    }

    // 3. Rédiger. C'est ici que tout se joue.
    const prep = await preparerPrevention(alerte);
    if (!prep.ok) {
      console.error('[prevention] contenu non préparé :', prep.raison);
      await rapport(
        `⚠️ Prévention non envoyée — ${alerte.title}`.slice(0, 120),
        `<h2 style="color:#b45309;font-size:18px">Aucun email n'est parti</h2>
         <p>L'article <strong>« ${echapper(alerte.title)} »</strong> a bien été
         <strong>publié</strong> dans l'application. En revanche, le contenu de
         prévention n'a pas pu être rédigé, donc <strong>rien n'a été envoyé aux
         clients</strong>.</p>
         <p style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:0 8px 8px 0">
           Raison : <strong>${echapper(prep.raison)}</strong></p>
         <p>Un email de prévention sans prévention ne serait qu'un relais de
         presse : on préfère ne rien envoyer et vous le dire. Si l'article s'y
         prête, vous pouvez rédiger le message à la main — sinon, il n'y a rien
         à faire, l'article reste visible dans l'application.</p>`
      );
      return ok({ envoye: 0, raison: prep.raison });
    }
    const contenu = prep.contenu;

    // 4. Réserver AVANT d'envoyer.
    const { error: eResa } = await supabase.from('sent_alerts').insert({
      alert_url: cle,
      alert_title: contenu.titre,
      source: alerte.source,
      recipients: 0,
      created_at: new Date().toISOString()
    });
    if (eResa) {
      // Sans réservation, on renonce : mieux vaut ne pas prévenir que risquer
      // d'écrire deux fois la même chose aux mêmes personnes.
      console.error('[prevention] réservation impossible :', eResa.message);
      await rapport(
        `⚠️ Prévention non envoyée — ${alerte.title}`.slice(0, 120),
        `<p>L'article a été publié, mais l'envoi a été <strong>annulé</strong> :
         impossible d'enregistrer la diffusion (<code>${echapper(eResa.message)}</code>).
         Sans cet enregistrement, un second clic réécrirait à tout le monde.</p>`
      );
      return ok({ envoye: 0, raison: 'reservation_impossible' });
    }

    // 5. Envoyer
    const { abonnes, gratuits, desinscrits } = await destinataires(supabase);
    const rA = await diffuser(abonnes, 'alerte_prevention', contenu, alerte);
    const rG = await diffuser(gratuits, 'alerte_prevention_free', contenu, alerte);
    const total = rA.envoyes + rG.envoyes;

    await supabase.from('sent_alerts').update({ recipients: total }).eq('alert_url', cle);

    // Notification : le titre de prévention, pas celui du journal. Elle mène à
    // l'application, pas à l'article — c'est là que se trouvent les réflexes.
    const push = await envoyerPush(supabase, {
      title: contenu.titre.slice(0, 80),
      body: (contenu.signes && contenu.signes[0]) || contenu.accroche.slice(0, 120),
      url: 'https://despy.fr/app',
      tag: tagDepuis(cle)
    });

    const echecs = [...rA.echecs, ...rG.echecs];
    await rapport(
      `✅ Prévention envoyée à ${total} personne(s) — ${contenu.titre}`.slice(0, 120),
      `<h2 style="color:#0a1f3a;font-size:18px">${echapper(contenu.titre)}</h2>
       <p>D'après <em>${echapper(alerte.title)}</em> (${echapper(alerte.source || 'presse')}).</p>
       <table cellpadding="6" style="border-collapse:collapse;font-size:14px;margin:14px 0">
         <tr><td style="border:1px solid #e6ebf2"><strong>Abonnés prévenus</strong></td>
             <td style="border:1px solid #e6ebf2">${rA.envoyes} / ${abonnes.length}</td></tr>
         <tr><td style="border:1px solid #e6ebf2"><strong>Comptes gratuits</strong></td>
             <td style="border:1px solid #e6ebf2">${rG.envoyes} / ${gratuits.length}</td></tr>
         <tr><td style="border:1px solid #e6ebf2"><strong>Notifications</strong></td>
             <td style="border:1px solid #e6ebf2">${push.sent} envoyée(s)${push.probleme ? ' — ' + echapper(push.probleme) : ''}</td></tr>
         <tr><td style="border:1px solid #e6ebf2">Désinscrits écartés</td>
             <td style="border:1px solid #e6ebf2">${desinscrits}</td></tr>
       </table>
       ${echecs.length ? `<p style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:0 8px 8px 0">
         <strong>${echecs.length} envoi(s) en échec :</strong><br>${echecs.map(echapper).join('<br>')}</p>` : ''}
       <p style="color:#888;font-size:12px;margin-top:18px">Contenu rédigé automatiquement à partir de l'article, puis vérifié
       (aucun montant ni lieu inventé). Cette alerte ne sera plus reproposée.</p>`
    );

    console.log(`[prevention] ${contenu.titre} → ${total} email(s), ${push.sent} push`);
    return ok({ envoye: total, abonnes: rA.envoyes, gratuits: rG.envoyes, push: push.sent });

  } catch (err) {
    console.error('[prevention] erreur:', err);
    await rapport(
      '⚠️ Prévention interrompue',
      `<p>Une erreur a interrompu l'envoi : <code>${echapper(err && err.message)}</code>.
       Vérifiez les journaux Netlify avant de recliquer.</p>`
    );
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
