// ════════════════════════════════════════════
// DESPY — Conseil hebdomadaire (avec progression)
// Cron : chaque lundi à 9h → 0 9 * * 1
// - Envoie à chaque abonné le PROCHAIN conseil qu'il n'a pas encore validé
//   (plus jamais de répétition une fois un conseil marqué « fait »).
// - Félicite l'abonné pour les conseils accomplis dans la semaine.
// - Bouton « ✅ C'est fait » → fonction tip-done.js (lien signé).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { WEEKLY_TIPS, TIPS_BY_ID, getIsoWeek } = require('./_weekly-tips');

// Jeton anti-triche pour le bouton « C'est fait » (lien GET dans l'email).
// Empêche de valider un conseil pour l'email d'un autre abonné.
function makeToken(email, tipId) {
  const secret = process.env.INTERNAL_SECRET || process.env.SUPABASE_SERVICE_KEY || 'despy';
  return crypto.createHmac('sha256', secret)
    .update((email || '').toLowerCase() + '|' + tipId)
    .digest('hex')
    .slice(0, 32);
}

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const N = WEEKLY_TIPS.length;

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('email, name, prenom')
      .eq('subscribed', true);

    if (!clients || clients.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    // Progression de TOUS les abonnés en une seule requête (conseils validés).
    // Si la table n'existe pas encore, on dégrade proprement (aucun blocage).
    const progressByEmail = {};
    try {
      const { data: progressRows, error: pErr } = await supabase
        .from('weekly_tip_log')
        .select('email, tip_id, completed_at')
        .not('completed_at', 'is', null);
      if (!pErr) {
        (progressRows || []).forEach(r => {
          const key = (r.email || '').toLowerCase();
          if (!progressByEmail[key]) progressByEmail[key] = { completed: new Set(), recent: [] };
          progressByEmail[key].completed.add(r.tip_id);
          const age = Date.now() - new Date(r.completed_at).getTime();
          if (age < 8 * 24 * 3600 * 1000) progressByEmail[key].recent.push(r.tip_id);
        });
      }
    } catch (e) { console.warn('weekly_tip_log absente, progression ignorée:', e.message); }

    // Abonnés désinscrits des conseils (table dédiée — n'affecte PAS le
    // statut d'abonné payant `subscribed`). Dégradation propre si absente.
    const optoutSet = new Set();
    try {
      const { data: outs } = await supabase.from('email_optouts').select('email');
      (outs || []).forEach(o => optoutSet.add((o.email || '').toLowerCase()));
    } catch (e) { /* table absente : on ignore */ }

    // Activité récente de CHAQUE abonné (7 derniers jours), en 2 requêtes
    // groupées (pas une par abonné). Sert à personnaliser l'email avec un
    // mot d'encouragement. Dégradation propre si une table manque.
    const activityByEmail = {};
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const bumpAct = (email, field) => {
      const k = (email || '').toLowerCase();
      if (!activityByEmail[k]) activityByEmail[k] = { analyses: 0, quiz: 0 };
      activityByEmail[k][field]++;
    };
    try {
      const { data: aRows } = await supabase
        .from('analyses_history').select('email, created_at').gte('created_at', weekAgo);
      (aRows || []).forEach(r => bumpAct(r.email, 'analyses'));
    } catch (e) { /* table absente : on ignore */ }
    try {
      const { data: qRows } = await supabase
        .from('quiz_history').select('email, created_at').gte('created_at', weekAgo);
      (qRows || []).forEach(r => bumpAct(r.email, 'quiz'));
    } catch (e) { /* table absente : on ignore */ }

    const weekNum = getIsoWeek(new Date());
    const start = (weekNum - 1 + N) % N;
    let sent = 0;

    for (const client of clients) {
      const prenom = client.prenom || client.name?.split(' ')[0] || 'cher membre';
      const emailKey = (client.email || '').toLowerCase();
      if (optoutSet.has(emailKey)) continue; // désinscrit des conseils
      const prog = progressByEmail[emailKey] || { completed: new Set(), recent: [] };

      // Choisir le prochain conseil NON validé, à partir de la position de la semaine.
      let tip = null;
      for (let k = 0; k < N; k++) {
        const cand = WEEKLY_TIPS[(start + k) % N];
        if (!prog.completed.has(cand.id)) { tip = cand; break; }
      }
      const allDone = !tip;
      if (allDone) tip = WEEKLY_TIPS[start]; // tout validé → on renvoie un rappel

      const commentList = tip.comment
        .map(c => `<li style="margin-bottom:10px">${c}</li>`)
        .join('');

      // Bandeau de félicitations si des conseils ont été validés cette semaine.
      const recentTitles = prog.recent
        .map(id => TIPS_BY_ID[id] && TIPS_BY_ID[id].titre)
        .filter(Boolean);
      const congratsBanner = recentTitles.length
        ? `<div style="background:#e9f9ef;border-left:4px solid #16a34a;border-radius:0 12px 12px 0;padding:18px;margin:0 0 20px">
             <p style="font-weight:800;color:#16a34a;margin:0 0 6px;font-size:16px">🎉 Bravo ${prenom} !</p>
             <p style="font-size:15px;color:#333;line-height:1.6;margin:0">Cette semaine, vous avez sécurisé : <strong>${recentTitles.join(' · ')}</strong>. Continuez comme ça, chaque geste compte.</p>
           </div>`
        : '';

      // Bandeau d'engagement : si le membre a utilisé Despy cette semaine.
      const act = activityByEmail[emailKey] || { analyses: 0, quiz: 0 };
      const actParts = [];
      if (act.analyses > 0) actParts.push(`<strong>${act.analyses}</strong> message${act.analyses > 1 ? 's' : ''} suspect${act.analyses > 1 ? 's' : ''} analysé${act.analyses > 1 ? 's' : ''}`);
      if (act.quiz > 0) actParts.push(`<strong>${act.quiz}</strong> quiz`);
      const activityBanner = actParts.length
        ? `<div style="background:#eef4ff;border-left:4px solid #2D5BFF;border-radius:0 12px 12px 0;padding:16px;margin:0 0 20px">
             <p style="font-size:15px;color:#333;line-height:1.6;margin:0">👏 Cette semaine, vous avez utilisé Despy : ${actParts.join(' et ')}. Bravo pour votre vigilance !</p>
           </div>`
        : '';

      // Bloc d'action : bouton « C'est fait » (ou message si tout est validé).
      const token = makeToken(client.email, tip.id);
      const doneUrl = `${process.env.URL}/.netlify/functions/tip-done?e=${encodeURIComponent(client.email)}&t=${encodeURIComponent(tip.id)}&k=${token}`;
      const unsubUrl = `${process.env.URL}/.netlify/functions/unsubscribe?e=${encodeURIComponent(client.email)}&k=${makeToken(client.email, 'unsub')}`;
      const sujet = tip.titre.substring(tip.titre.indexOf(' ') + 1);
      // Préheader : texte d'aperçu affiché dans la boîte de réception.
      const preheader = `Votre conseil sécurité de la semaine : ${sujet}`;
      const actionBlock = allDone
        ? `<p style="font-size:15px;color:#16a34a;text-align:center;font-weight:700;margin:8px 0 0">✅ Vous avez parcouru tous nos conseils essentiels. Voici un rappel utile !</p>`
        : `<div style="text-align:center;margin:4px 0 0">
             <a href="${doneUrl}" style="background:#16a34a;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
               ✅ C'est fait, je l'ai mis en place
             </a>
             <p style="font-size:12px;color:#999;margin:10px 0 0">En cliquant, Despy le note et ne vous renverra plus ce conseil.</p>
           </div>`;

      try {
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SECRET || ''
          },
          body: JSON.stringify({
            type: 'custom',
            data: {
              email: client.email,
              subject: `🛡️ Conseil Despy : ${sujet}`,
              html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
                <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0">${preheader}</div>
                <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:28px;color:#fff;text-align:center">
                  <div style="font-size:11px;font-weight:700;opacity:.7;letter-spacing:2px">DESPY — CONSEIL HEBDOMADAIRE</div>
                  <div style="font-size:20px;font-weight:900;margin-top:8px">Semaine ${weekNum}</div>
                </div>
                <div style="padding:28px">
                  <p style="font-size:17px;color:#111">Bonjour <strong>${prenom}</strong> 👋</p>
                  ${congratsBanner}
                  ${activityBanner}
                  <div style="background:#f0f3ff;border-left:4px solid #2D5BFF;border-radius:0 12px 12px 0;padding:22px;margin:20px 0">
                    <p style="font-weight:800;color:#2D5BFF;margin:0 0 14px;font-size:19px;line-height:1.4">${tip.titre}</p>
                    <p style="font-size:16px;color:#333;line-height:1.7;margin:0 0 14px"><strong style="color:#0a1f3a">C'est quoi&nbsp;?</strong> ${tip.quoi}</p>
                    <p style="font-size:16px;color:#333;line-height:1.7;margin:0 0 14px"><strong style="color:#0a1f3a">Pourquoi c'est important&nbsp;?</strong> ${tip.pourquoi}</p>
                    <p style="font-size:16px;color:#0a1f3a;font-weight:700;margin:0 0 8px">Comment faire&nbsp;:</p>
                    <ul style="font-size:16px;color:#333;line-height:1.75;margin:0 0 18px;padding-left:22px">${commentList}</ul>
                    ${actionBlock}
                  </div>
                  <div style="text-align:center;margin:24px 0">
                    <a href="https://despy.fr" style="background:#2D5BFF;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                      Poser une question au Conseiller →
                    </a>
                  </div>
                  <p style="font-size:12px;color:#aaa;text-align:center;margin:0 0 6px">Despy · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
                  <p style="font-size:12px;color:#bbb;text-align:center;line-height:1.6;margin:0">Vous recevez ce conseil car vous êtes membre Despy.<br><a href="${unsubUrl}" style="color:#999;text-decoration:underline">Se désabonner des conseils</a> (sans effet sur votre abonnement)</p>
                </div>
              </div>`
            }
          })
        });
        sent++;

        // Journalise l'envoi (sans écraser une éventuelle validation passée).
        if (!allDone) {
          try {
            await supabase.from('weekly_tip_log')
              .upsert({ email: emailKey, tip_id: tip.id, sent_at: new Date().toISOString() },
                      { onConflict: 'email,tip_id' });
          } catch (e) { /* table absente : on ignore */ }
        }
      } catch (e) { console.error('Email error:', client.email, e); }
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Conseils hebdomadaires envoyés: ${sent}`);
    return { statusCode: 200, body: JSON.stringify({ sent }) };

  } catch (err) {
    console.error('Weekly report error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
