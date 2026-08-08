// ════════════════════════════════════════════════════════
// DESPY — Cercle de confiance : personne de confiance
// Un proche (enfant, conjoint…) est alerté quand Despy
// détecte un danger : fuite dark web, SOS, arnaque détectée.
// Actions : get / set (vider les champs = retirer le proche)
// ════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email requis' }) };
    }

    const auth = requireAuth(event, body, email, headers);
    if (!auth.ok) return auth.response;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Le compte doit exister
    // `family_word` est récent : si la migration n'est pas passée, on retombe
    // sur le jeu de colonnes historique plutôt que de casser la personne de
    // confiance, qui elle fonctionne depuis longtemps.
    const COLS_BASE = 'email, prenom, name, trusted_contact_name, trusted_contact_email';
    let { data: client, error: selErr } = await supabase
      .from('clients').select(COLS_BASE + ', family_word').eq('email', email).maybeSingle();
    if (selErr) {
      console.warn('trusted-contact : colonne family_word absente, repli —', selErr.message);
      ({ data: client, error: selErr } = await supabase
        .from('clients').select(COLS_BASE).eq('email', email).maybeSingle());
    }

    if (selErr) {
      console.error('trusted-contact select error:', selErr.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Service momentanément indisponible' }) };
    }
    if (!client) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Compte introuvable' }) };
    }

    // ── Le mot de passe famille ──
    // Despy enseigne cette parade dans sa formation (« convenez d'un mot
    // secret ») sans l'avoir jamais fournie. Avec le clonage de voix par IA,
    // c'est la seule défense qui tienne contre « mamie c'est moi ».
    // Stocké en clair à dessein : il doit être affichable au client ET
    // transmissible à son proche. Ce n'est pas un secret d'authentification,
    // c'est un code de reconnaissance partagé.
    if (body.action === 'set_word') {
      const mot = String(body.family_word || '').trim().slice(0, 40);
      const { error: eMot } = await supabase.from('clients')
        .update({ family_word: mot || null, updated_at: new Date().toISOString() })
        .eq('email', email);
      if (eMot) {
        console.error('trusted-contact set_word:', eMot.message);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, raison: 'migration_absente' }) };
      }
      // Le proche doit le connaître, sinon le mot ne sert à rien.
      if (mot && client.trusted_contact_email) {
        try {
          const prenom = client.prenom || (client.name || '').split(' ')[0] || 'Un proche';
          await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
            body: JSON.stringify({ type: 'custom', data: {
              email: client.trusted_contact_email,
              subject: `Le mot de passe famille de ${prenom}`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                <div style="background:linear-gradient(135deg,#0a1f3a,#1a3fd9);padding:26px;color:#fff;border-radius:14px 14px 0 0">
                  <div style="font-size:11px;font-weight:700;opacity:.85;letter-spacing:2px">DESPY — CERCLE DE CONFIANCE</div>
                  <div style="font-size:21px;font-weight:900;margin-top:6px">🔑 Votre mot de passe famille</div>
                </div>
                <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px;padding:26px;font-size:15px;line-height:1.75;color:#333">
                  <p><strong>${prenom}</strong> vient de convenir d'un mot de passe familial avec vous.</p>
                  <div style="background:#f7f9fc;border:2px dashed #2D5BFF;border-radius:12px;padding:20px;text-align:center;margin:18px 0">
                    <div style="font-size:12px;color:#666;letter-spacing:1px;font-weight:700">LE MOT</div>
                    <div style="font-size:30px;font-weight:900;color:#0a1f3a;letter-spacing:1px;margin-top:6px">${mot}</div>
                  </div>
                  <p style="font-size:14px;color:#555"><strong>À quoi ça sert :</strong> aujourd'hui, quelques secondes de voix suffisent à en fabriquer une imitation convaincante. Si « ${prenom} » vous appelle en urgence pour de l'argent — ou si quelqu'un vous appelle en se faisant passer pour un proche — <strong>demandez ce mot</strong>. Une voix s'imite ; ce mot, non.</p>
                  <p style="font-size:14px;color:#555">Apprenez-le par cœur, et ne le communiquez à personne d'autre.</p>
                  <p style="font-size:11px;color:#aaa;text-align:center;margin-top:22px">Despy · <a href="https://despy.fr" style="color:#2D5BFF">despy.fr</a></p>
                </div></div>`
            }})
          });
        } catch (e) { console.warn('Envoi du mot au proche échoué:', e.message); }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, family_word: mot || null }) };
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
        contact_email: client.trusted_contact_email || null,
        family_word: client.family_word || null
      })
    };

  } catch (err) {
    console.error('trusted-contact error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
