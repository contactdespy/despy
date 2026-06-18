// ════════════════════════════════════════════
// DESPY — Clic sur un test d'entraînement
// Appelé par la page /entrainement quand la personne a cliqué sur le
// message-test. Enregistre le clic, renvoie le débrief (indices + bon
// réflexe) à afficher, et prévient gentiment le proche (cercle de confiance).
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { byId } = require('./training-templates');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const token = (event.queryStringParameters && event.queryStringParameters.t) || '';
  if (!token || token.length < 8) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Lien invalide' }) };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: rec } = await supabase
      .from('training_tests')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (!rec) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Test introuvable' }) };

    const tpl = byId(rec.template_id);
    const firstClick = !rec.clicked_at;

    if (firstClick) {
      await supabase.from('training_tests')
        .update({ clicked_at: new Date().toISOString() })
        .eq('token', token);

      // Alerte bienveillante au proche (une seule fois)
      if (rec.trusted_contact_email) {
        try {
          const prenom = rec.prenom || 'votre proche';
          const cName = rec.trusted_contact_name || '';
          await fetch(`${process.env.URL || 'https://despy.fr'}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
            body: JSON.stringify({
              type: 'custom',
              data: {
                email: rec.trusted_contact_email,
                subject: `Despy — ${prenom} vient de passer un test anti-arnaque`,
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
                  <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:28px 32px;text-align:center">
                    <div style="font-size:22px;font-weight:900;color:#fff">Despy</div>
                    <div style="font-size:11px;color:#5BE3F5;letter-spacing:.18em;text-transform:uppercase;margin-top:6px">Entraînement anti-arnaque</div>
                  </div>
                  <div style="background:#fff;padding:32px">
                    <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 16px">Bonjour${cName ? ' ' + cName : ''},</p>
                    <p style="font-size:16px;color:#444;line-height:1.65;margin:0 0 18px"><strong>Bonne nouvelle : c'était un test, sans aucun danger.</strong> Despy a envoyé une fausse arnaque d'entraînement à ${prenom}, qui a cliqué dessus. C'est exactement pour ça que l'entraînement existe : repérer les réflexes à renforcer, dans un cadre sûr.</p>
                    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:18px 20px;margin:0 0 18px">
                      <div style="font-size:14px;font-weight:800;color:#1a3fd9;margin-bottom:8px">Votre petit geste qui aide</div>
                      <div style="font-size:14px;color:#444;line-height:1.7">Appelez ${prenom} et reparlez-en 5 minutes, sans dramatiser : « en cas de doute, on ne clique pas, on vérifie ». C'est ce simple échange qui protège le mieux.</div>
                    </div>
                    <p style="font-size:12px;color:#888;line-height:1.6">Vous recevez ce message car ${prenom} vous a désigné comme personne de confiance sur Despy. Aucune donnée personnelle n'est partagée.</p>
                    <p style="font-size:11px;color:#aaa;text-align:center;margin-top:18px">Despy · <a href="https://despy.fr" style="color:#2D5BFF;text-decoration:none">despy.fr</a></p>
                  </div>
                </div>`
              }
            })
          });
        } catch (e) { console.warn('Alerte proche entraînement échouée:', e.message); }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        prenom: rec.prenom || null,
        brand: tpl ? tpl.brand : '',
        title: tpl ? tpl.title : 'Message-test',
        redFlags: tpl ? tpl.redFlags : [],
        reflex: tpl ? tpl.reflex : ''
      })
    };
  } catch (err) {
    console.error('training-click error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erreur serveur' }) };
  }
};
