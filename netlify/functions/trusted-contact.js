// ════════════════════════════════════════════════════════
// DESPY — Cercle de confiance : personne de confiance
// Un proche (enfant, conjoint…) est alerté quand Despy
// détecte un danger : fuite dark web, SOS, arnaque détectée.
// Actions : get / set (vider les champs = retirer le proche)
// ════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Le compte doit exister
    const { data: client, error: selErr } = await supabase
      .from('clients')
      .select('email, prenom, name, trusted_contact_name, trusted_contact_email')
      .eq('email', email)
      .maybeSingle();

    if (selErr) {
      // Colonnes pas encore créées dans Supabase → message explicite côté serveur
      console.error('trusted-contact select error:', selErr.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Service momentanément indisponible' }) };
    }
    if (!client) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Compte introuvable' }) };
    }

    if (body.action === 'set') {
      const cName = (body.contact_name || '').trim().substring(0, 80);
      const cEmail = (body.contact_email || '').toLowerCase().trim().substring(0, 120);
      if (cEmail && !cEmail.includes('@')) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email du proche invalide' }) };
      }
      if (cEmail && cEmail === email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Le proche doit être une autre personne que vous' }) };
      }

      const { error: updErr } = await supabase.from('clients').update({
        trusted_contact_name: cName || null,
        trusted_contact_email: cEmail || null,
        updated_at: new Date().toISOString()
      }).eq('email', email);

      if (updErr) {
        console.error('trusted-contact update error:', updErr.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Enregistrement impossible' }) };
      }

      // Prévenir le proche qu'il a été désigné (transparence + RGPD)
      if (cEmail) {
        try {
          const prenom = client.prenom || (client.name || '').split(' ')[0] || 'Un membre Despy';
          await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-secret': process.env.INTERNAL_SECRET || ''
            },
            body: JSON.stringify({
              type: 'custom',
              data: {
                email: cEmail,
                subject: `${prenom} vous a désigné comme personne de confiance sur Despy`,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
                    <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:28px;color:#fff">
                      <div style="font-size:11px;font-weight:700;opacity:.8;letter-spacing:2px">DESPY — CERCLE DE CONFIANCE</div>
                      <div style="font-size:22px;font-weight:900;margin-top:6px">👥 Vous veillez désormais sur ${prenom}</div>
                    </div>
                    <div style="padding:28px">
                      <p style="font-size:15px;color:#333;line-height:1.7"><strong>${prenom}</strong> (${client.email}) utilise Despy, un service français de protection contre les arnaques en ligne, et vous a désigné comme <strong>personne de confiance</strong>.</p>
                      <p style="font-size:14px;color:#555;line-height:1.7">Concrètement, vous recevrez une alerte par email si Despy détecte un danger qui le/la concerne :</p>
                      <div style="background:#f7f9fc;border-radius:12px;padding:16px;font-size:14px;color:#444;line-height:2">
                        🕵️ Ses données apparaissent dans une fuite (dark web)<br>
                        🚨 Une arnaque grave est détectée dans ses messages<br>
                        🆘 Il/elle déclenche un appel à l'aide (SOS)
                      </div>
                      <p style="font-size:13px;color:#888;line-height:1.6;margin-top:18px">Vous n'avez rien à faire ni rien à installer. Aucune donnée personnelle de ${prenom} ne vous est transmise en dehors de ces alertes. Si vous ne souhaitez pas recevoir ces alertes, répondez simplement à cet email.</p>
                      <p style="font-size:11px;color:#aaa;text-align:center;margin-top:22px">Despy · Cybersécurité pour tous · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
                    </div>
                  </div>`
              }
            })
          });
        } catch (e) { console.warn('Email proche non envoyé:', e.message); }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, contact_name: cName || null, contact_email: cEmail || null }) };
    }

    // action par défaut : get
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        contact_name: client.trusted_contact_name || null,
        contact_email: client.trusted_contact_email || null
      })
    };

  } catch (err) {
    console.error('trusted-contact error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
