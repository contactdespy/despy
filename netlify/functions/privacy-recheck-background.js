// ════════════════════════════════════════════
// DESPY — Privacy Cleanup : reprise mensuelle (le travail)
// Déclenchée par privacy-recheck.js, le 1er du mois à 5 h UTC.
// POST interne (x-internal-secret), sans corps.
//
// Fonction BACKGROUND (suffixe -background) : une fonction planifiée est
// coupée au bout de 30 secondes, et ce passage traite les clients un par un —
// trois lettres espacées pour chacun. À cinq clients il dépassait déjà : les
// derniers de la liste n'auraient reçu ni lettres ni recherche, sans erreur
// nulle part. Ici, 15 minutes.
//
// Il manquait la seule chose qui rendait le service vivant. L'envoi RGPD et le
// scan ne partaient QUE depuis le formulaire d'activation : un client activé en
// mai n'avait plus rien eu ensuite, et l'espace client lui promettait pourtant
// une revérification tous les mois. Cette fonction est ce qui tient la promesse.
//
// Deux choses, et volontairement pas une de plus :
//
//   1. RATTRAPAGE — on appelle privacy-dispatch pour chaque demande active.
//      C'est lui qui sait ce qui est déjà parti, annuaire par annuaire, et à
//      la bonne adresse : il n'envoie que ce qui manque, et rien si tout est
//      fait. Un client jamais traité reçoit donc tout ; un client traité avant
//      qu'une adresse soit corrigée ou qu'un annuaire soit ajouté reçoit
//      seulement cette lettre-là.
//
//   2. RE-SCAN — on relance la recherche d'empreinte pour détecter une
//      réapparition. Les trouvailles arrivent en statut 'found' et restent
//      invisibles du client jusqu'à validation humaine, comme au premier scan.
//
// Ce qu'on ne fait PAS : renvoyer chaque mois la demande art. 17 aux mêmes
// annuaires. Un rappel mensuel non justifié ferait classer despy.fr en spam par
// les brokers, et on perdrait le canal qui marche pour les vrais nouveaux cas.
// On ne ré-envoie qu'à un broker où la donnée est réellement réapparue — ce que
// le scan détecte, et qui passe par la validation humaine.
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { ecrire, alerterAdmin } = require('./_db');

exports.handler = async (event) => {
  // Appelable uniquement par privacy-recheck.js : ce passage envoie des
  // lettres juridiques au nom de clients, il ne doit pas répondre à une URL.
  const recu = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
  if (!process.env.INTERNAL_SECRET || recu !== process.env.INTERNAL_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('privacy-recheck: Supabase non configuré');
    return { statusCode: 200, body: JSON.stringify({ skipped: 'no_supabase' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const base = process.env.URL;
  const secret = process.env.INTERNAL_SECRET || '';

  // Sans secret interne, privacy-dispatch répond 401 et le scan refuse aussi.
  // Mieux vaut le dire une fois dans les logs que tourner à vide tous les mois.
  if (!secret) {
    console.error('privacy-recheck: INTERNAL_SECRET absent — dispatch et scan impossibles');
    return { statusCode: 200, body: JSON.stringify({ skipped: 'no_internal_secret' }) };
  }

  // Sans clé de recherche, le re-scan est sauté pour tout le monde — et la
  // page de vente, l'espace client et l'email d'activation promettent une
  // nouvelle recherche chaque mois. Le rattrapage peut tourner quand même,
  // mais ce silence-là doit se voir : une alerte, une fois par passage.
  const sansRecherche = !process.env.BRAVE_SEARCH_KEY;
  if (sansRecherche) {
    console.error('privacy-recheck: BRAVE_SEARCH_KEY absente — aucune nouvelle recherche ce mois-ci');
    await alerterAdmin(
      'privacy-recheck — nouvelle recherche impossible',
      'BRAVE_SEARCH_KEY est absente des variables Netlify : la recherche mensuelle promise aux clients '
      + 'n\'a pas eu lieu. Le rattrapage des demandes RGPD, lui, a tourné.',
      {}
    );
  }

  // On lit TOUT et on écarte les annulées en JS. Filtrer côté base avec
  // .neq('status','cancelled') paraissait plus propre, mais en SQL
  // `status <> 'cancelled'` vaut NULL quand status est NULL — la ligne est
  // écartée sans bruit. Les demandes les plus anciennes, celles qui ont
  // justement besoin du rattrapage, sont précisément celles qui peuvent avoir
  // un status vide.
  const { data: toutes, error: errDemandes } = await supabase
    .from('privacy_requests')
    .select('user_email, prenom, nom, target_email, phone, ville, activated_at, status');

  if (errDemandes) {
    console.error('privacy-recheck: lecture privacy_requests:', errDemandes.message);
    return { statusCode: 200, body: JSON.stringify({ error: errDemandes.message }) };
  }

  const demandes = (toutes || []).filter(d => d.status !== 'cancelled');
  if (demandes.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ demandes: 0 }) };
  }

  // Une seule demande par email : on garde la plus récente. Un client qui a
  // réactivé le service ne doit pas recevoir deux fois les mêmes envois.
  const parEmail = new Map();
  for (const d of demandes) {
    const cle = (d.user_email || '').toLowerCase().trim();
    if (!cle) continue;
    const vue = parEmail.get(cle);
    if (!vue || new Date(d.activated_at || 0) > new Date(vue.activated_at || 0)) {
      parEmail.set(cle, d);
    }
  }

  let rattrapages = 0, scans = 0, erreurs = 0;

  for (const [email, d] of parEmail) {
    try {
      // ── 1. Rattrapage : ce qui manque, annuaire par annuaire ──
      const champs = ['prenom', 'nom', 'target_email', 'phone', 'ville'];
      const manquants = champs.filter(k => !d[k]);
      if (manquants.length) {
        // Demande incomplète (ancien formulaire) : on ne devine pas l'identité
        // d'un client pour envoyer une lettre juridique en son nom.
        console.warn(`privacy-recheck ${email}: rattrapage impossible, champs manquants: ${manquants.join(', ')}`);
      } else {
        const r = await fetch(`${base}/.netlify/functions/privacy-dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
          body: JSON.stringify({
            user_email: email, prenom: d.prenom, nom: d.nom,
            target_email: d.target_email, phone: d.phone, ville: d.ville,
            activated_at: d.activated_at
          })
        });
        if (r.ok) {
          let rep = {};
          try { rep = await r.json(); } catch (e) {}
          if (rep.sent > 0) {
            rattrapages++;
            console.log(`privacy-recheck ${email}: ${rep.sent} lettre(s) envoyée(s)`);
          }
          // Une lettre en échec repartira au passage suivant, mais ce mois-ci
          // ce client n'est pas servi : ça compte comme une erreur à signaler.
          if (rep.failed > 0) erreurs++;
        } else {
          erreurs++;
          console.error(`privacy-recheck ${email}: dispatch HTTP ${r.status}`);
        }
      }

      // ── 2. Re-scan d'empreinte ──
      let scanFait = false;
      if (!sansRecherche && d.prenom && d.nom) {
        const s = await fetch(`${base}/.netlify/functions/privacy-scan-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
          body: JSON.stringify({
            user_email: email, prenom: d.prenom, nom: d.nom,
            target_email: d.target_email, phone: d.phone, ville: d.ville
          })
        });
        // Une fonction background répond 202 sans attendre la fin du travail.
        if (s.status === 202 || s.ok) { scans++; scanFait = true; }
        else { erreurs++; console.error(`privacy-recheck ${email}: scan HTTP ${s.status}`); }
      }

      // ── 3. Date de dernier passage, pour que l'espace client dise vrai ──
      // Uniquement si le scan est réellement parti. Écrire la date après un
      // échec afficherait « vérifié le 1er octobre » pour une vérification qui
      // n'a pas eu lieu : c'est précisément le genre de mensonge qu'on répare.
      if (scanFait) {
        await ecrire(
          supabase.from('privacy_requests')
            .update({ last_scan_at: new Date().toISOString() })
            .eq('user_email', email),
          `privacy_requests.last_scan_at — ${email}`
        );
      }

      // Les envois RGPD partent par Resend : on espace pour ne pas déclencher
      // de limitation de débit sur un lot de clients.
      await new Promise(r => setTimeout(r, 1200));

    } catch (e) {
      erreurs++;
      console.error(`privacy-recheck ${email}:`, e.message);
    }
  }

  const bilan = { demandes: parEmail.size, rattrapages, scans, erreurs };
  console.log('privacy-recheck:', JSON.stringify(bilan));

  // Un cron mensuel qui échoue à 3h du matin n'a aucun témoin. Une seule alerte
  // par exécution, et seulement s'il y a eu un problème : un rapport « tout va
  // bien » chaque mois finirait par ne plus être ouvert, et c'est le silence
  // qu'on veut fiable.
  if (erreurs > 0) {
    await alerterAdmin(
      `privacy-recheck — ${erreurs} client(s) en échec`,
      'Le passage mensuel Privacy Cleanup ne s’est pas déroulé entièrement. '
      + 'Le détail par client est dans les logs Netlify de cette fonction.',
      { 'Demandes traitées': parEmail.size, 'Clients avec lettres envoyées': rattrapages,
        'Scans lancés': scans, 'Échecs': erreurs }
    );
  }

  return { statusCode: 200, body: JSON.stringify(bilan) };
};
