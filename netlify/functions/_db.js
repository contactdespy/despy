// ════════════════════════════════════════════
// DESPY — Écritures Supabase qui ne peuvent plus échouer en silence
//
// Le client Supabase NE LÈVE PAS d'exception quand une écriture échoue : il
// renvoie `{ data, error }`. Tout le projet est pourtant écrit ainsi :
//
//     try { await supabase.from('x').insert(y); }
//     catch (e) { console.warn('insert:', e.message); }   // ← jamais atteint
//
// Le `catch` est du code mort. La ligne n'est pas écrite, `e` n'existe pas,
// et rien ne remonte nulle part. C'est exactement ce qui fait qu'un espace
// client peut afficher « 0 » pendant des mois sans que personne le sache.
//
// Deux fonctions ici, et volontairement pas une de plus :
//
//   ecrire(requete, contexte)   — insert / update / delete
//   lire(requete, contexte)     — select
//
// Toutes deux renvoient { ok, data, error } et n'explosent jamais : l'appelant
// décide s'il continue ou s'il s'arrête. L'option { alerte: true } envoie en
// plus un email à l'admin — à réserver aux écritures dont la perte casse le
// service, parce qu'une alerte qui arrive tous les jours cesse d'être lue.
// ════════════════════════════════════════════

const ADMIN = 'contact.despy@gmail.com';

// Une même panne touche souvent tous les clients d'une boucle cron. On n'envoie
// qu'UN email par type de problème et par exécution : 200 emails identiques
// seraient classés en spam, et c'est justement le canal qu'on veut fiable.
const dejaAlerte = new Set();

async function alerterAdmin(contexte, message, details) {
  const cle = contexte.split(' ')[0];
  if (dejaAlerte.has(cle)) return;
  dejaAlerte.add(cle);

  if (!process.env.RESEND_API_KEY) {
    console.error('_db: RESEND_API_KEY absente — alerte non envoyée');
    return;
  }

  const lignes = Object.entries(details || {})
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px">${k}</td>`
                   + `<td style="padding:6px 0;font-family:monospace;font-size:13px">${String(v)}</td></tr>`)
    .join('');

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#991b1b;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:800;opacity:.85">Despy · Base de données</div>
    <div style="font-size:20px;font-weight:900;margin-top:4px">Une écriture a échoué</div>
  </div>
  <div style="background:#fff;padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <p style="margin:0 0 14px;color:#374151;line-height:1.6">
      <strong>${contexte}</strong><br>
      La donnée n'a pas été enregistrée. Sans intervention, elle est perdue.
    </p>
    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 14px;border-radius:6px;margin-bottom:14px">
      <div style="font-family:monospace;font-size:13px;color:#7f1d1d;word-break:break-word">${message}</div>
    </div>
    ${lignes ? `<table style="width:100%;border-collapse:collapse">${lignes}</table>` : ''}
    <p style="color:#6b7280;font-size:12px;margin-top:18px;border-top:1px solid #e5e7eb;padding-top:12px">
      Une seule alerte est envoyée par type de problème et par exécution.
      S'il y a d'autres clients touchés, ils sont dans les logs Netlify.
    </p>
  </div>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Despy <contact@despy.fr>',
        to: [ADMIN],
        subject: `⚠️ Despy — écriture BDD échouée : ${contexte}`,
        html
      })
    });
    if (!res.ok) console.error(`_db: alerte Resend HTTP ${res.status} — ${contexte}`);
  } catch (e) {
    // L'alerte ne doit JAMAIS faire tomber l'appelant : on est déjà en train
    // de gérer une panne, en ajouter une deuxième n'aide personne.
    console.error('_db: alerte impossible:', e.message);
  }
}

async function _executer(requete, contexte, opts, verbe) {
  const { alerte = false, details = null } = opts || {};
  let res;
  try {
    res = await requete;
  } catch (e) {
    // Panne réseau, URL Supabase absente, client mal construit : là, ça lève
    // pour de vrai. On le ramène au même format que l'erreur métier.
    res = { data: null, error: { message: e.message } };
  }

  if (res && res.error) {
    console.error(`BDD ÉCHEC — ${verbe} ${contexte}: ${res.error.message}`);
    if (alerte) await alerterAdmin(contexte, res.error.message, details);
    return { ok: false, data: null, error: res.error };
  }

  return { ok: true, data: res ? res.data : null, error: null };
}

// Insert / update / delete. `contexte` doit dire QUOI et POUR QUI :
//   ecrire(supabase.from('x').insert(y), `privacy_requests ${email}`)
const ecrire = (requete, contexte, opts) => _executer(requete, contexte, opts, 'écriture');

// Select. Même contrat : l'appelant regarde `ok` avant de croire `data`.
// Sans ça, une table inaccessible se lit comme une table vide — et une table
// vide, dans ce projet, s'affiche au client comme « 0 ».
const lire = (requete, contexte, opts) => _executer(requete, contexte, opts, 'lecture');

module.exports = { ecrire, lire, alerterAdmin };
