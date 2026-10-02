// ════════════════════════════════════════════════════════
// DESPY — Privacy Cleanup : récupération du statut
// GET /privacy-status?email=xxx → renvoie la dernière demande active
// ════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');
const { lire } = require('./_db');
const { annuaire, dernieres, affichage } = require('./_privacy-suivi');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' };

  try {
    const email = (event.queryStringParameters?.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
    }

    const auth = requireAuth(event, null, email, headers);
    if (!auth.ok) return auth.response;

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      // Pas de config Supabase → réponse "rien" silencieuse
      return { statusCode: 200, headers, body: JSON.stringify({ active: false }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Récupère la dernière demande pour cet email
    const { data, error } = await supabase
      .from('privacy_requests')
      .select('*')
      .eq('user_email', email)
      .order('activated_at', { ascending: false })
      .limit(1);

    if (error) {
      // Table inaccessible. On renvoyait `active:false`, ce qui revient à dire
      // au client « vous n'avez jamais activé le service » — et lui réaffiche
      // le formulaire d'activation, qu'il risque de resoumettre en doublon.
      // `indisponible` permet à l'espace client de dire la vérité : on ne sait
      // pas, réessayez.
      console.error(`BDD ÉCHEC — lecture privacy_requests ${email}: ${error.message}`);
      return { statusCode: 200, headers, body: JSON.stringify({ active: false, indisponible: true }) };
    }

    if (!data || data.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ active: false }) };
    }

    const req = data[0];

    // Prochaine vérification = le prochain passage RÉEL du cron, pas une date
    // théorique. C'était « activation + 30 jours » : pour un client activé en mai,
    // la date était dépassée depuis des mois et l'espace client affichait
    // « Nouvelle vérification dans 0 jour » à vie. La cadence vraie est celle de
    // privacy-recheck dans netlify.toml : le 1er du mois à 5h UTC.
    const maintenant = new Date();
    let prochain = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1, 5, 0, 0));
    if (prochain <= maintenant) {
      prochain = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1, 5, 0, 0));
    }
    const nextScan = prochain.toISOString();

    // ── Construction des ÉLÉMENTS RÉELS visibles par le client ──
    // Deux sources, toutes deux factuelles / validées :
    //   1. Demandes RGPD réellement envoyées (privacy_dispatch_log)
    //   2. Trouvailles du scan VALIDÉES par l'équipe (privacy_findings status=validated)
    // Rien d'autre n'est exposé (les trouvailles non validées / ignorées restent invisibles).
    const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
    const CAT_LABEL = { annuaire: 'Annuaire', reseau_social: 'Réseau social', presse_blog: 'Article / blog', donnees_legales: 'Registre légal', autre: 'Site web' };
    const items = [];

    // Une lecture qui échoue renvoyait `undefined`, devenu `[]`, devenu « 0 »
    // à l'écran : une table inaccessible était donc affichée au client comme
    // « aucune donnée supprimée ». Indiscernable de la vérité. On suit
    // maintenant l'échec, et on le dit au lieu d'afficher un zéro inventé.
    let degrade = false;

    // 1. Demandes RGPD envoyées
    const lgs = await lire(
      supabase.from('privacy_dispatch_log')
        .select('broker_id, broker_name, status, sent_at')
        .eq('user_email', email),
      `privacy_dispatch_log — ${email}`
    );
    if (!lgs.ok) degrade = true;
    // Une ligne par annuaire, la plus récente : une lettre renvoyée ou une
    // relance ajoute une ligne au journal, pas un annuaire de plus à l'écran.
    // Un annuaire sorti de la liste (il ne publiait pas de particuliers) ne
    // s'affiche plus « en cours » pour toujours.
    for (const l of dernieres(lgs.data || []).values()) {
      const b = annuaire(l.broker_id);
      if (!b) continue;
      const a = affichage(l);
      items.push({ name: b.name, kind: a.kind, status: a.status, hint: a.hint, date: l.sent_at });
    }

    // 2. Trouvailles validées
    {
      const fnd = await lire(
        supabase.from('privacy_findings')
          .select('url, category, action, status, reason, found_at')
          .eq('user_email', email)
          .eq('status', 'validated'),
        `privacy_findings — ${email}`
      );
      if (!fnd.ok) degrade = true;
      (fnd.data || []).forEach(f => {
        const dom = domainOf(f.url);
        const label = CAT_LABEL[f.category] || 'Site web';
        // guide_client = une action côté client (ex. profil LinkedIn) ; sinon suppression en cours
        const status = f.action === 'guide_client' ? 'action' : 'encours';
        items.push({
          name: dom ? `${label} · ${dom}` : label,
          kind: f.action === 'guide_client' ? 'Une action de votre part' : 'Suppression en cours',
          status,
          hint: f.action === 'guide_client' ? (f.reason || '') : '',
          url: f.url,
          date: f.found_at
        });
      });
    }

    const stats = {
      supprime: items.filter(i => i.status === 'supprime').length,
      encours:  items.filter(i => i.status === 'encours').length,
      action:   items.filter(i => i.status === 'action').length,
      total:    items.length
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        active: true,
        activated_at: req.activated_at,
        prenom: req.prenom,
        nom: req.nom,
        target_email: req.target_email,
        phone: req.phone,
        ville: req.ville,
        status: req.status || 'pending',
        items,
        stats,
        // true = au moins une lecture a échoué, donc les compteurs sont faux
        // et probablement sous-évalués. L'espace client affiche un message
        // plutôt que des chiffres qu'il ne peut pas garantir.
        degrade,
        last_scan_at: req.last_scan_at || null,
        next_scan: nextScan
      })
    };

  } catch (err) {
    console.error('privacy-status error:', err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ active: false, error: err.message })
    };
  }
};
