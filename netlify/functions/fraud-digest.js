// ════════════════════════════════════════════
// DESPY — Alerte Secteur : récap hebdomadaire GRATUIT
// Cron : chaque vendredi 17h (voir netlify.toml)
//
// Pour chaque inscrit aux alertes (fraud_alert_subs) NON premium :
// s'il y a eu des signalements approuvés dans SA commune (même code
// postal) sur les 7 derniers jours → un email récap sobre.
// (Les premium, eux, ont déjà reçu chaque alerte en temps réel.)
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { CATEGORIES } = require('./_fraud-alerts');

function digestHTML(prenom, ville, items) {
  const rows = items.map(r => `
    <div style="padding:14px 18px;border-bottom:1px solid #f1f3f7">
      <div style="font-size:14.5px;font-weight:800;color:#0a1f3a">⚠️ ${CATEGORIES[r.category] || r.category}</div>
      <div style="font-size:13.5px;color:#555;line-height:1.6;margin-top:3px">${r.description || ''}</div>
      <div style="font-size:11.5px;color:#999;margin-top:4px">${(r.created_at || '').slice(0, 10)}</div>
    </div>`).join('');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
    <div style="background:#010410;padding:24px 32px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="color:#fff;font-size:22px;font-weight:900;width:130px;max-width:50%;height:auto;display:inline-block;border:0">
      <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:10px">Alerte Secteur — votre semaine</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="background:#fff;padding:32px">
      <h1 style="margin:0 0 10px;font-size:22px;color:#0a1f3a">Cette semaine à ${ville}</h1>
      <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 18px">Bonjour${prenom ? ' ' + prenom : ''}, ${items.length === 1 ? 'une arnaque a été signalée' : items.length + ' arnaques ont été signalées'} près de chez vous par des membres Despy :</p>
      <div style="border:1px solid #e8ecf3;border-radius:14px;overflow:hidden;margin:0 0 20px">${rows}</div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 18px;margin:0 0 20px">
        <div style="font-size:13.5px;color:#444;line-height:1.7">⚡ <strong>Envie d'être prévenu immédiatement ?</strong> Les membres Premium reçoivent chaque alerte <strong>en temps réel</strong> (notification sur le téléphone) et couvrent <strong>tout leur département</strong> — pas seulement leur commune.</div>
      </div>
      <div style="text-align:center;margin:0 0 6px">
        <a href="https://despy.fr/carte-arnaques" style="display:inline-block;background:#2D5BFF;color:#fff;padding:14px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">Voir la carte de mon secteur</a>
      </div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="padding:22px 32px;text-align:center;background:#010410">
      <p style="font-size:13px;color:rgba(255,255,255,.7);margin:0">Despy · Alerte Secteur · <a href="https://despy.fr" style="color:#5BE3F5;text-decoration:none">despy.fr</a></p>
    </div>
  </div>`;
}

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: subs, error } = await supabase.from('fraud_alert_subs').select('email, ville, code_postal');
    if (error) {
      console.warn('fraud-digest subs (migration manquante ?):', error.message);
      return { statusCode: 200, body: JSON.stringify({ sent: 0, error: 'select' }) };
    }
    if (!subs || subs.length === 0) return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };

    // Signalements approuvés de la semaine
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: reports } = await supabase
      .from('fraud_reports')
      .select('category, description, code_postal, created_at')
      .eq('status', 'approved')
      .gte('created_at', since);
    if (!reports || reports.length === 0) return { statusCode: 200, body: JSON.stringify({ sent: 0, note: 'aucun signalement cette semaine' }) };

    // Infos clients (premium = déjà alertés en temps réel ; prénoms pour le ton)
    const { data: clients } = await supabase.from('clients').select('email, prenom, name, subscribed');
    const byEmail = new Map((clients || []).map(c => [(c.email || '').toLowerCase(), c]));

    // Désinscriptions génériques
    const optedOut = new Set();
    try {
      const { data: outs } = await supabase.from('email_optouts').select('email');
      (outs || []).forEach(o => optedOut.add((o.email || '').toLowerCase()));
    } catch (e) {}

    let sent = 0;
    for (const sub of subs) {
      const email = (sub.email || '').toLowerCase();
      if (optedOut.has(email)) continue;
      const cli = byEmail.get(email);
      if (cli && cli.subscribed) continue; // premium : déjà servi en temps réel

      const items = reports.filter(r => r.code_postal === sub.code_postal);
      if (items.length === 0) continue;

      const prenom = (cli && (cli.prenom || (cli.name || '').split(' ')[0])) || '';
      try {
        await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
          body: JSON.stringify({
            type: 'custom',
            data: {
              email: sub.email,
              subject: `⚠️ ${items.length === 1 ? 'Une arnaque signalée' : items.length + ' arnaques signalées'} cette semaine à ${sub.ville}`,
              html: digestHTML(prenom, sub.ville, items.slice(0, 6))
            }
          })
        });
        sent++;
        await new Promise(r => setTimeout(r, 800));
      } catch (e) { console.error(`digest ${email}:`, e.message); }
    }

    console.log(`fraud-digest : ${sent} récaps envoyés`);
    return { statusCode: 200, body: JSON.stringify({ sent }) };
  } catch (e) {
    console.error('fraud-digest:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
