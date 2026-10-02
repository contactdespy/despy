// ════════════════════════════════════════════
// DESPY — Le bilan du proche (module partagé)
//
// Celui qui veille sur un senior ne recevait de Despy que les mauvaises
// nouvelles : une fuite, un SOS, une arnaque détectée. Un mois calme, rien —
// et ce silence ressemble à un service qui ne sert pas. C'est pourtant lui,
// le fils ou la fille, qui décide de payer et qui en parle autour de lui.
//
// Une fois par mois, s'il le veut bien et si le senior l'a choisi, il reçoit
// ce que Despy a fait : combien de messages vérifiés, combien d'arnaques
// repérées, ou — et c'est l'information que personne ne lui donnait —
// « elle ne s'en est pas servie ce mois-ci ».
//
// Trois règles, et elles ne se négocient pas :
//
//   1. DES NOMBRES, JAMAIS LE CONTENU. Ni un message, ni une question, ni un
//      numéro. L'écran où le senior désigne son proche lui promet « il ne
//      verra rien de votre vie privée » ; ce bilan tient cette promesse.
//   2. UNIQUEMENT SI LE SENIOR L'A CHOISI (`clients.bilan_proche`), pour ce
//      proche-là : changer de proche remet le choix à zéro.
//   3. AUCUN CHIFFRE INVENTÉ. Une lecture qui échoue donne « inconnu », et la
//      ligne disparaît du bilan — elle ne devient pas un zéro. Un zéro
//      affiché se lit « elle n'a rien fait », alors que c'est nous qui
//      n'avons pas su lire.
// ════════════════════════════════════════════

const { lire } = require('./_db');
const { couvertureFamille } = require('./_famille');

// Le mois écoulé, en UTC : le bilan part le 1er, il parle du mois d'avant.
function moisPrecedent(maintenant) {
  const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
  const debut = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - 1, 1));
  const NOMS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                'septembre', 'octobre', 'novembre', 'décembre'];
  return {
    debut: debut.toISOString(),
    fin: fin.toISOString(),
    cle: debut.toISOString().slice(0, 7),                       // 'AAAA-MM', comme clients.chat_period
    libelle: `${NOMS[debut.getUTCMonth()]} ${debut.getUTCFullYear()}`
  };
}

// À qui part le bilan : la personne de confiance si elle est désignée, sinon
// celui qui paie la formule Famille. Personne d'autre, et jamais le senior.
async function destinataire(supabase, client) {
  const soi = (client.email || '').toLowerCase().trim();
  const conf = (client.trusted_contact_email || '').toLowerCase().trim();
  if (conf && conf !== soi) {
    return { email: conf, nom: client.trusted_contact_name || '', lien: 'confiance' };
  }
  const fam = await couvertureFamille(supabase, soi);
  if (fam.couvert && fam.owner && fam.owner.toLowerCase() !== soi) {
    return { email: fam.owner.toLowerCase(), nom: fam.ownerPrenom || '', lien: 'famille' };
  }
  return null;
}

// Les chiffres du mois. `null` = on n'a pas pu lire, `0` = on a lu et il n'y a rien.
async function collecter(supabase, client, mois) {
  const email = (client.email || '').toLowerCase().trim();
  const dans = (q, col) => q.gte(col, mois.debut).lt(col, mois.fin);
  const s = { verifies: null, arnaques: null, quiz: null, entrainements: null, pieges: null,
              sos: null, questions: null, derniere: null };

  const an = await lire(dans(supabase.from('analyses_history').select('verdict, created_at').eq('email', email), 'created_at'),
                        `analyses_history (bilan) — ${email}`);
  if (an.ok) {
    s.verifies = (an.data || []).length;
    s.arnaques = (an.data || []).filter((a) => a.verdict === 'scam').length;
  }

  const qz = await lire(dans(supabase.from('quiz_history').select('created_at').eq('email', email), 'created_at'),
                        `quiz_history (bilan) — ${email}`);
  if (qz.ok) s.quiz = (qz.data || []).length;

  // Les faux messages d'entraînement : `clicked_at` rempli = il s'est fait piéger.
  const tr = await lire(dans(supabase.from('training_tests').select('sent_at, clicked_at').eq('email', email), 'sent_at'),
                        `training_tests (bilan) — ${email}`);
  if (tr.ok) {
    s.entrainements = (tr.data || []).length;
    s.pieges = (tr.data || []).filter((t) => t.clicked_at).length;
  }

  const so = await lire(dans(supabase.from('sos_requests').select('submitted_at').eq('user_email', email), 'submitted_at'),
                        `sos_requests (bilan) — ${email}`);
  if (so.ok) s.sos = (so.data || []).length;

  // Le compteur de questions ne garde qu'un mois : s'il a déjà basculé sur le
  // mois en cours, celui du mois écoulé est perdu. On ne le reconstitue pas.
  if (client.chat_period === mois.cle) s.questions = client.chat_period_used || 0;

  // Dernière utilisation connue, tous mois confondus — pour pouvoir dire
  // « depuis le 14 août » plutôt qu'un vague « pas récemment ».
  const dates = [];
  for (const [table, colMail, colDate] of [['analyses_history', 'email', 'created_at'],
                                           ['quiz_history', 'email', 'created_at'],
                                           ['sos_requests', 'user_email', 'submitted_at']]) {
    const r = await lire(
      supabase.from(table).select(colDate).eq(colMail, email).lt(colDate, mois.fin)
        .order(colDate, { ascending: false }).limit(1),
      `${table} (dernière utilisation) — ${email}`);
    if (r.ok && r.data && r.data[0] && r.data[0][colDate]) dates.push(new Date(r.data[0][colDate]));
  }
  if (dates.length) s.derniere = new Date(Math.max.apply(null, dates.map((d) => d.getTime()))).toISOString();

  return s;
}

const pl = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Les phrases du bilan. Seules les lignes qu'on SAIT y figurent.
function phrases(s) {
  const l = [];
  if (s.verifies > 0) {
    l.push({ icone: '🔎', texte: `${pl(s.verifies, 'message vérifié', 'messages vérifiés')} avec Despy`
      + (s.arnaques > 0 ? `, dont <strong>${pl(s.arnaques, 'arnaque repérée', 'arnaques repérées')}</strong>` : ', aucun n\'était une arnaque') });
  }
  if (s.questions > 0) l.push({ icone: '💬', texte: `${pl(s.questions, 'question posée', 'questions posées')} à son Conseiller` });
  if (s.entrainements > 0) {
    l.push({ icone: '🎯', texte: `${pl(s.entrainements, 'faux message d\'entraînement reçu', 'faux messages d\'entraînement reçus')} : `
      + (s.pieges > 0 ? `${pl(s.pieges, 'clic', 'clics')} — c'est fait pour ça, mieux vaut ici qu'ailleurs` : 'aucun clic') });
  }
  if (s.quiz > 0) l.push({ icone: '📚', texte: `${pl(s.quiz, 'quiz terminé', 'quiz terminés')}` });
  if (s.sos > 0) l.push({ icone: '🆘', texte: `${pl(s.sos, 'appel à l\'aide', 'appels à l\'aide')} — vous en avez été prévenu au moment même` });
  return l;
}

// A-t-on pu lire assez pour affirmer « aucune activité » ?
function rienDuTout(s) {
  return s.verifies === 0 && s.quiz === 0 && s.sos === 0
      && (s.entrainements === 0 || s.entrainements === null)
      && (s.questions === 0 || s.questions === null);
}

function bilanHTML({ prenomSenior, dest, mois, stats, destinataireClient }) {
  const qui = prenomSenior || 'Votre proche';
  const lignes = phrases(stats);
  const jour = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

  let corps;
  if (lignes.length) {
    corps = lignes.map((x) => `
      <div style="padding:13px 16px;border-top:1px solid #edf0f5;font-size:15px;color:#333;line-height:1.6">
        <span style="display:inline-block;width:28px">${x.icone}</span>${x.texte}
      </div>`).join('');
    corps = `<div style="border:1px solid #e8ecf3;border-radius:14px;overflow:hidden;margin:0 0 20px">
      <div style="background:#0a1f3a;padding:11px 16px;font-size:12px;color:#5BE3F5;text-transform:uppercase;letter-spacing:.1em;font-weight:700">En ${mois.libelle}</div>
      ${corps}</div>`;
  } else if (rienDuTout(stats)) {
    corps = `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:18px;margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      <strong>${qui} n'a pas utilisé Despy en ${mois.libelle}.</strong><br>
      Aucun message vérifié${stats.questions === 0 ? ', aucune question' : ''}.${stats.derniere ? ` Sa dernière utilisation remonte au ${jour(stats.derniere)}.` : ''}
      <br><br>Ce n'est pas forcément mauvais signe — mais si un message douteux lui est arrivé, on ne l'a pas vu.
      Un coup de fil pour lui remontrer le bouton « Vérifier un message »&nbsp;?
    </div>`;
  } else {
    // On n'a pas pu tout lire : on le dit, on n'affirme ni activité ni absence.
    corps = `<div style="background:#f7f9fc;border:1px solid #e8ecf3;border-radius:14px;padding:18px;margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      Nous n'avons pas pu réunir tous les chiffres de ${mois.libelle}. Plutôt que de vous en donner d'incomplets,
      nous préférons ne rien affirmer ce mois-ci.
    </div>`;
  }

  const pourquoi = dest.lien === 'famille'
    ? `${qui} a choisi de partager ce bilan avec vous, qui lui offrez sa protection.`
    : `${qui} vous a désigné comme personne de confiance et a choisi de partager ce bilan avec vous.`;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f7f9fc">
    <div style="background:#010410;padding:24px 32px;text-align:center">
      <img src="https://despy.fr/assets/logo-despy-email-dark.png" alt="Despy" width="130" style="color:#fff;font-size:22px;font-weight:900;width:130px;max-width:50%;height:auto;display:inline-block;border:0">
      <div style="font-size:11px;color:#5BE3F5;letter-spacing:.2em;text-transform:uppercase;margin-top:10px">Le bilan du mois</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="background:#fff;padding:34px 32px">
      <h1 style="margin:0 0 12px;font-size:22px;color:#0a1f3a">${qui} et Despy, en ${mois.libelle}</h1>
      <p style="font-size:14.5px;color:#666;line-height:1.7;margin:0 0 20px">
        ${dest.nom ? `Bonjour ${dest.nom},<br>` : ''}${pourquoi}
        Il ne contient que des nombres : ni ses messages, ni ses questions.
      </p>
      ${corps}
      ${destinataireClient ? '' : `<p style="font-size:13.5px;color:#666;line-height:1.7;margin:0 0 4px">
        Vous aussi, vous recevez des messages douteux&nbsp;? Despy vérifie les vôtres :
        <a href="https://despy.fr" style="color:#1a3fd9;font-weight:700">despy.fr</a>
      </p>`}
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#2D5BFF,#5BE3F5,#2D5BFF);font-size:0;line-height:0">&nbsp;</div>
    <div style="padding:22px 32px;text-align:center;background:#010410">
      <p style="font-size:13.5px;color:rgba(255,255,255,.75);margin:0">Une question ? contact@despy.fr — un humain vous répond.</p>
    </div>
  </div>`;
}

const handler = async () => ({ statusCode: 404, body: 'Not found' }); // module partagé, pas un endpoint
module.exports = { moisPrecedent, destinataire, collecter, phrases, rienDuTout, bilanHTML, handler };
