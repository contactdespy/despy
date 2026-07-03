// ════════════════════════════════════════════
// DESPY — TEMPORAIRE : envoie à Sandrine (cliente d'avant la fonctionnalité)
// l'email de consultation « est-ce vous ? » pour ses annuaires inversés
// (nom LEWILLE + son numéro). À SUPPRIMER après usage.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { signFinding } = require('./_privacy-sign');

const KEY = 'b7d1aa010fd1ec20c80ecdf6';
const EMAIL = 'sandrinebouazzaoui000@gmail.com';
const PRENOM = 'Sandrine';

function buildConsultHTML(email, prenom, items) {
  const base = 'https://despy.fr';
  const cards = items.map(f => {
    const yesUrl = `${base}/.netlify/functions/privacy-confirm?e=${encodeURIComponent(email)}&f=${f.id}&r=yes&k=${signFinding(email, f.id, 'cyes')}`;
    const noUrl = `${base}/.netlify/functions/privacy-confirm?e=${encodeURIComponent(email)}&f=${f.id}&r=no&k=${signFinding(email, f.id, 'cno')}`;
    let host = '';
    try { host = new URL(f.url).hostname.replace(/^www\./, ''); } catch (e) {}
    return `
      <div style="border:1px solid #e8ecf3;border-radius:14px;padding:20px;margin:0 0 16px;background:#fcfdff">
        <div style="font-size:15px;color:#0a1f3a;line-height:1.6;margin-bottom:4px">Nous avons trouvé <strong>votre numéro de téléphone</strong> sur le site <strong>${host || 'un annuaire'}</strong>…</div>
        <div style="font-size:14px;color:#666;line-height:1.6;margin-bottom:16px">…mais il y est affiché sous le nom <strong>« ${(f.title || '').replace(/\|.*/, '').trim().slice(0, 40) || 'un autre nom'} »</strong>. Est-ce bien vous&nbsp;?</div>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:10px"><a href="${yesUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-size:15px;font-weight:800">✓ Oui, c'est moi</a></td>
          <td><a href="${noUrl}" style="display:inline-block;background:#f1f3f7;color:#444;text-decoration:none;padding:14px 26px;border-radius:10px;font-size:15px;font-weight:800">✗ Non, ce n'est pas moi</a></td>
        </tr></table>
      </div>`;
  }).join('');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
    <div style="background:#010410;padding:24px 32px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="color:#fff;font-size:22px;font-weight:900;width:130px;max-width:50%;height:auto;display:inline-block;border:0">
      <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:10px">Privacy Cleanup — une petite vérification</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="background:#fff;padding:34px 32px">
      <h1 style="margin:0 0 12px;font-size:22px;color:#0a1f3a">Une question rapide, ${prenom} 🙂</h1>
      <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 22px">En nettoyant votre présence sur internet, nous avons trouvé quelque chose d'un peu ambigu. Pour ne rien supprimer par erreur, on préfère vous demander. <strong>Un seul clic suffit</strong> — pas besoin de répondre à cet email.</p>
      ${cards}
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 18px;margin:6px 0 0">
        <div style="font-size:13.5px;color:#444;line-height:1.7">💡 <strong>Pourquoi cette question&nbsp;?</strong> Parfois un numéro a appartenu à quelqu'un d'autre avant vous, ou il est publié sous un ancien nom (nom de naissance…). Vous seul(e) le savez&nbsp;: votre réponse nous permet d'agir sans risque.</div>
      </div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="padding:24px 32px;text-align:center;background:#010410">
      <p style="font-size:14px;color:rgba(255,255,255,.75);margin:0 0 6px">Un doute ? Écrivez-nous — un humain vous répond.</p>
      <p style="font-size:14px;color:#5BE3F5;margin:0;font-weight:600">contact@despy.fr</p>
    </div>
  </div>`;
}

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).k !== KEY) return { statusCode: 404, body: 'Not found' };
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Récupérer ses fiches d'annuaires inversés (nom LEWILLE / url d'annuaire)
  const { data: all } = await supabase.from('privacy_findings').select('id, title, url, category').eq('user_email', EMAIL);
  const items = (all || []).filter(f =>
    /lewille/i.test(f.title || '') || /annu/i.test(f.url || '') || f.category === 'annuaire'
  ).filter(f => !/linkedin/i.test(f.url || ''));

  if (items.length === 0) return { statusCode: 200, body: JSON.stringify({ sent: 0, note: 'aucune fiche ambiguë trouvée' }) };

  // Les repasser en attente de confirmation client
  for (const f of items) {
    await supabase.from('privacy_findings').update({ action: 'demander_client', status: 'found' }).eq('id', f.id);
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Despy <contact@despy.fr>',
      to: [EMAIL],
      subject: `${PRENOM}, une petite vérification pour votre Privacy Cleanup`,
      html: buildConsultHTML(EMAIL, PRENOM, items)
    })
  });

  return { statusCode: 200, body: JSON.stringify({ sent: r.ok ? items.length : 0, items: items.map(i => i.id) }) };
};
