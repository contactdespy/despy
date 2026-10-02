// ════════════════════════════════════════════
// DESPY — Le bilan du proche (le travail)
// Déclenché par bilan-proche.js, le 1er du mois. POST interne (x-internal-secret).
//
// Pour chaque senior qui l'a choisi, envoie à celui qui veille sur lui les
// chiffres du mois écoulé. Le contenu et ses règles sont dans _bilan-proche.js.
//
// L'email passe par send-email avec `marketing: true` : c'est un envoi
// périodique que le proche n'a pas demandé lui-même. Il porte donc le lien
// « se désinscrire », et s'arrête pour de bon s'il clique — c'est son accord à
// lui, comme `bilan_proche` est celui du senior.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { lire, alerterAdmin } = require('./_db');
const { moisPrecedent, destinataire, collecter, bilanHTML } = require('./_bilan-proche');

exports.handler = async (event) => {
  // Ce passage lit l'activité de clients et écrit à des tiers : il ne répond
  // pas à une URL.
  const recu = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
  if (!process.env.INTERNAL_SECRET || recu !== process.env.INTERNAL_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const mois = moisPrecedent(new Date());

  // Seuls ceux qui ont dit oui. Si la colonne manque, la migration n'est pas
  // passée : personne n'a pu dire oui, on n'envoie rien — et on le signale,
  // sinon la fonction resterait muette tous les mois sans que personne le sache.
  const lus = await lire(
    supabase.from('clients')
      .select('email, prenom, name, trusted_contact_name, trusted_contact_email, chat_period, chat_period_used, bilan_proche')
      .eq('bilan_proche', true),
    'clients (bilan du proche)',
    { alerte: true, details: { 'Cause probable': 'colonne clients.bilan_proche absente — lancer sql_migration_bilan_proche.sql' } }
  );
  if (!lus.ok) return { statusCode: 200, body: JSON.stringify({ error: 'lecture' }) };

  let envoyes = 0, sansProche = 0, arretes = 0, erreurs = 0;

  for (const client of lus.data || []) {
    try {
      const dest = await destinataire(supabase, client);
      if (!dest) { sansProche++; continue; }       // le proche a été retiré depuis

      const stats = await collecter(supabase, client, mois);
      const prenomSenior = client.prenom || (client.name || '').split(' ')[0] || '';

      // Le proche est-il lui-même client ? Sinon, une ligne l'invite à essayer.
      const cli = await lire(
        supabase.from('clients').select('email').eq('email', dest.email).limit(1),
        `clients (le proche est-il client ?) — ${dest.email}`);
      const destinataireClient = !!(cli.ok && cli.data && cli.data.length);

      const r = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
        body: JSON.stringify({ type: 'custom', data: {
          email: dest.email,
          marketing: true,
          pourquoi: `Vous recevez ce bilan parce que ${prenomSenior || 'un proche'} a choisi de le partager avec vous.`,
          subject: `Le bilan de ${prenomSenior || 'votre proche'} — ${mois.libelle}`,
          html: bilanHTML({ prenomSenior, dest, mois, stats, destinataireClient })
        } })
      });
      if (!r.ok) { erreurs++; console.error(`bilan-proche ${client.email}: send-email HTTP ${r.status}`); }
      else {
        // send-email répond 200 aussi quand il RETIENT l'envoi : le proche s'est
        // désinscrit. Ce n'est pas un bilan envoyé, et ce n'est pas une panne.
        let rep = {};
        try { rep = await r.json(); } catch (e) {}
        if (rep.sent === false) arretes++; else envoyes++;
      }

      await new Promise((ok) => setTimeout(ok, 600));   // Resend : 2 envois par seconde au plus
    } catch (e) {
      erreurs++;
      console.error(`bilan-proche ${client.email}:`, e.message);
    }
  }

  const bilan = { mois: mois.cle, seniors: (lus.data || []).length, envoyes, sansProche, arretes, erreurs };
  console.log('bilan-proche:', JSON.stringify(bilan));
  if (erreurs > 0) {
    await alerterAdmin(
      `bilan-proche — ${erreurs} bilan(s) non partis`,
      'Certains proches n\'ont pas reçu leur bilan mensuel. Le détail est dans les logs Netlify de cette fonction.',
      { 'Seniors concernés': (lus.data || []).length, 'Bilans envoyés': envoyes, 'Échecs': erreurs }
    );
  }
  return { statusCode: 200, body: JSON.stringify(bilan) };
};
