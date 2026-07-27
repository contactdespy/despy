// ════════════════════════════════════════════
// DESPY — Notifications « douces » de réengagement (push)
// Cron hebdomadaire (voir netlify.toml).
//
// RÈGLE ABSOLUE — ciblage :
//   On ne relance JAMAIS un abonné Premium actif (subscribed = true).
//   Eux ont déjà payé : ils ne reçoivent QUE les vraies alertes
//   (fuite de données, arnaque locale…), qui sont un service, pas une relance.
//   Les notifs douces sont réservées aux comptes GRATUITS et aux ANCIENS
//   abonnés (résiliés/expirés) → tous à subscribed = false.
//
// Cadence : 1 notif / semaine maximum, ton « valeur » (on apporte une info
// utile avant de glisser l'abonnement en douceur). Messages en rotation.
//
// Garde-fous :
//   - subscribed = false uniquement (exclut les Premium actifs)
//   - doit avoir un appareil abonné aux push (table push_subscriptions)
//   - respecte les désinscriptions globales (table email_optouts)
//   - laisse les tout nouveaux inscrits à l'onboarding (< 10 jours ignorés)
//   - plafond 1/semaine via clients.last_nudge_at (fenêtre 6 jours)
//   - best-effort : ne casse rien si une colonne/table manque
//     (dégrade en douceur avant la migration SQL)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// Messages « valeur » en rotation. On tourne via clients.nudge_step, donc
// chaque membre voit un thème différent chaque semaine (cycle ~6 semaines).
// Ton : utile d'abord, jamais culpabilisant, jamais « revenez SVP ».
const NUDGES = [
  {
    title: '🛡️ L’arnaque qui circule en ce moment',
    body: 'Le faux SMS « votre colis est en attente ». Apprenez à la repérer en 30 secondes.',
    url: 'https://despy.fr/app?tool=alertes'
  },
  {
    title: '🔓 Vos mots de passe ont-ils fuité ?',
    body: 'Vérifiez gratuitement si votre adresse email s’est retrouvée dans une fuite de données.',
    url: 'https://despy.fr/app?tool=darkweb'
  },
  {
    title: '💬 Un message qui vous intrigue ?',
    body: 'SMS, mail, lien douteux… Montrez-le à Despy, on vous dit tout de suite si c’est une arnaque.',
    url: 'https://despy.fr/app?tool=analyseur'
  },
  {
    title: '📚 Reprenez votre formation anti-arnaque',
    body: '5 minutes cette semaine, et vous ne tomberez plus dans le panneau. On continue ?',
    url: 'https://despy.fr/app?tab=home'
  },
  {
    title: '💡 Le bon réflexe de la semaine',
    body: 'Votre banque ne vous demandera JAMAIS votre code par SMS. En cas de doute, demandez à Despy.',
    url: 'https://despy.fr/app?tool=analyseur'
  },
  {
    title: '📞 Vous n’êtes pas seul face aux arnaques',
    body: 'Un doute sur un appel, un mail, un paiement ? Avec Despy, un vrai conseiller vous répond.',
    url: 'https://despy.fr/app?tool=sos'
  }
];

const MIN_AGE_DAYS = 10;   // on laisse l'onboarding faire son travail avant
const CAP_DAYS = 6;        // au plus une notif douce tous les 6 jours

exports.handler = async (event) => {
  // SÉCURITÉ : envoie des notifs → ne s'exécute QUE sur déclenchement planifié.
  const { isScheduled, notScheduled } = require('./_is-scheduled');
  if (!isScheduled(event)) return notScheduled();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Sans push configuré, inutile de continuer (l'email reste le canal fiable).
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, error: 'vapid_unconfigured' }) };
  }

  try {
    // 1. Comptes NON abonnés (gratuits + anciens abonnés). Jamais un Premium actif.
    //    On tente de lire last_nudge_at/nudge_step ; si la migration n'est pas
    //    passée, on retombe sur une sélection minimale (dégradation douce).
    let clients = null;
    let hasNudgeCols = true;

    let res = await supabase
      .from('clients')
      .select('email, prenom, name, created_at, last_nudge_at, nudge_step')
      .eq('subscribed', false);

    if (res.error) {
      hasNudgeCols = false;
      res = await supabase
        .from('clients')
        .select('email, prenom, name, created_at')
        .eq('subscribed', false);
    }
    clients = res.data;

    if (res.error || !clients || clients.length === 0) {
      if (res.error) console.error('nudge: select clients:', res.error.message);
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    // 2. Appareils abonnés aux push (on ne notifie que ces emails-là)
    const pushEmails = new Set();
    try {
      const { data: subs } = await supabase.from('push_subscriptions').select('email');
      (subs || []).forEach(s => { if (s.email) pushEmails.add(s.email.toLowerCase()); });
    } catch (e) { console.warn('nudge: push_subscriptions', e.message); }

    if (pushEmails.size === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0, reason: 'no_push_devices' }) };
    }

    // 3. Désinscriptions globales à respecter (quelqu'un qui a dit « laissez-moi »)
    const optedOut = new Set();
    try {
      const { data: outs } = await supabase.from('email_optouts').select('email');
      (outs || []).forEach(o => { if (o.email) optedOut.add(o.email.toLowerCase()); });
    } catch (e) { console.warn('nudge: email_optouts', e.message); }

    const now = Date.now();
    let sent = 0, skipped = 0, failed = 0;

    for (const c of clients) {
      const email = (c.email || '').toLowerCase();
      if (!email || !email.includes('@')) { skipped++; continue; }
      if (!pushEmails.has(email)) { skipped++; continue; }   // pas d'appareil push
      if (optedOut.has(email)) { skipped++; continue; }        // a demandé le calme

      // Trop récent → on laisse l'onboarding-sequence tranquille
      const created = c.created_at ? new Date(c.created_at).getTime() : 0;
      if (created && (now - created) / 86400000 < MIN_AGE_DAYS) { skipped++; continue; }

      // Plafond 1/semaine
      const last = c.last_nudge_at ? new Date(c.last_nudge_at).getTime() : 0;
      if (last && (now - last) / 86400000 < CAP_DAYS) { skipped++; continue; }

      const step = c.nudge_step || 0;
      const msg = NUDGES[step % NUDGES.length];

      try {
        const r = await fetch(`${process.env.URL}/.netlify/functions/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({ email, title: msg.title, body: msg.body, url: msg.url })
        });

        if (!r.ok) { failed++; console.error(`nudge send -> ${email}:`, r.status); continue; }
        const out = await r.json().catch(() => ({}));
        if (!out.sent) { skipped++; continue; }   // aucun appareil joignable (endpoint nettoyé)

        // On n'avance le compteur que si la migration est là (sinon, on n'écrit rien)
        if (hasNudgeCols) {
          await supabase.from('clients')
            .update({ last_nudge_at: new Date().toISOString(), nudge_step: step + 1 })
            .eq('email', c.email);
        }
        sent++;
        await new Promise(res2 => setTimeout(res2, 250)); // douceur
      } catch (e) {
        failed++;
        console.error(`nudge error ${email}:`, e.message);
      }
    }

    console.log(`nudge-push : ${sent} envoyées, ${skipped} ignorées, ${failed} échecs` +
                (hasNudgeCols ? '' : ' (migration non passée : compteur non écrit)'));
    return { statusCode: 200, body: JSON.stringify({ sent, skipped, failed, migrated: hasNudgeCols }) };
  } catch (err) {
    console.error('nudge-push error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
