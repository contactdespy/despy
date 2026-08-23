// ════════════════════════════════════════════
// DESPY — Le calendrier des arnaques de saison
//
// Pourquoi ce fichier existe : le 23 août 2026, TF1 a consacré un sujet aux
// arnaques de la rentrée. Ce jour-là, l'appli Despy affichait en tête
// « Soldes d'été : 7 conseils » — un article de 81 jours. Nos trois sources
// (CNIL, Cybermalveillance, ANSSI) sont des institutions : elles publient
// APRÈS, une fois le phénomène constaté et le communiqué relu. Aucune
// optimisation ne nous fera doubler une chaîne de télévision qui reçoit du
// courrier de victimes.
//
// D'où le renversement : on ne cherche plus à devancer les médias, on devance
// l'escroc. Ces arnaques ne sont pas des surprises, ce sont des anniversaires.
// Elles suivent le calendrier administratif et commercial — avis d'impôt en
// septembre, taxe foncière en octobre, colis en novembre — et reviennent aux
// mêmes dates chaque année. Une fiche écrite une fois se republie donc
// indéfiniment, sans source à interroger et sans rien qui puisse tomber en
// panne. C'est le seul étage de la chaîne d'alertes qui fonctionne avec zéro
// utilisateur, zéro réseau et zéro chance.
//
// La fenêtre s'ouvre volontairement AVANT le pic : prévenir le 15 août d'une
// arnaque de rentrée a du sens, le 20 septembre non — à ce moment-là les
// victimes existent déjà, et on n'est plus qu'un média de plus.
// ════════════════════════════════════════════

// Chaque fiche : une fenêtre 'MM-JJ', un titre, et un corps qui tient dans une
// notification. La dernière phrase est toujours le geste à faire — un senior
// qui lit ça sur son téléphone doit savoir quoi faire, pas seulement avoir peur.
//
// Règle du lien : il pointe TOUJOURS vers le vrai site que l'escroc imite, et
// jamais ailleurs. Le geste qu'on enseigne est toujours le même — « allez-y
// vous-même plutôt que de cliquer » — et le bouton doit faire exactement ce
// que dit le texte, sinon on enseigne l'inverse. Les arnaques qui n'imitent
// aucun site (le ramoneur qui sonne, le démarcheur au téléphone) n'ont donc
// pas de lien : leur réponse est de fermer la porte, pas d'ouvrir un site.
const FICHES = [
  {
    id: 'rentree-caf',
    debut: '08-15', fin: '09-25',
    titre: 'Rentrée : le faux SMS de la CAF qui promet la prime',
    corps: 'À la rentrée, un SMS annonce une allocation à récupérer en cliquant sur un lien. '
      + 'La CAF ne verse jamais une aide par SMS et ne demande jamais votre numéro de carte '
      + 'bancaire. Si le message vous concerne vraiment, ouvrez vous-même votre espace sur '
      + 'caf.fr — sans passer par le lien.',
    lien: 'https://www.caf.fr'
  },
  {
    id: 'avis-impot',
    debut: '08-20', fin: '10-10',
    titre: 'Avis d’impôt : la fausse promesse de remboursement',
    corps: 'C’est la saison des avis d’imposition, donc celle des faux courriels « vous avez '
      + 'droit à un remboursement ». Les impôts ne réclament jamais vos coordonnées bancaires '
      + 'par mail ni par SMS. Un remboursement se voit dans votre espace sur impots.gouv.fr, '
      + 'que vous ouvrez vous-même.',
    lien: 'https://www.impots.gouv.fr'
  },
  {
    id: 'taxe-fonciere',
    debut: '09-15', fin: '11-05',
    titre: 'Taxe foncière : le faux avis et le faux retard de paiement',
    corps: 'La taxe foncière se paie à l’automne : les escrocs envoient de faux avis et de '
      + 'fausses relances menaçant d’une majoration. Un vrai avis figure toujours dans votre '
      + 'espace impots.gouv.fr. Ne payez jamais depuis un lien reçu par message, même s’il '
      + 'vous met la pression.',
    lien: 'https://www.impots.gouv.fr'
  },
  {
    id: 'chauffage-ramonage',
    debut: '09-20', fin: '11-30',
    titre: 'Avant l’hiver : le faux ramoneur et le faux contrôle de chaudière',
    corps: 'Quelqu’un sonne et annonce un « contrôle obligatoire » de votre chaudière ou de '
      + 'votre conduit, à faire tout de suite. Aucun contrôle ne s’impose par une visite '
      + 'surprise. Ne laissez entrer personne que vous n’avez pas appelé vous-même, et '
      + 'demandez une carte professionnelle avant d’ouvrir.'
  },
  {
    id: 'colis-black-friday',
    debut: '11-05', fin: '12-10',
    titre: 'Black Friday : le pic annuel des faux SMS de livraison',
    corps: 'C’est la période où l’on attend tous un colis — et celle où le faux SMS « votre '
      + 'colis est bloqué, réglez 2 € » fonctionne le mieux. Ces deux euros servent à '
      + 'enregistrer votre carte bancaire. Suivez vos colis uniquement depuis le site du '
      + 'marchand chez qui vous avez commandé.'
  },
  {
    id: 'noel-dons',
    debut: '12-01', fin: '01-08',
    titre: 'Noël : faux livreurs à la porte et fausses cagnottes',
    corps: 'En décembre, les visites imprévues passent inaperçues : faux livreur qui demande '
      + 'à entrer, fausse collecte pour une association. Ne faites jamais entrer un livreur, '
      + 'et ne donnez jamais en espèces sur le pas de la porte. Pour donner, allez vous-même '
      + 'sur le site de l’association.'
  },
  {
    id: 'carte-vitale',
    debut: '01-05', fin: '02-25',
    titre: 'La fausse carte Vitale « à renouveler »',
    corps: 'En début d’année revient le message annonçant que votre carte Vitale expire et '
      + 'doit être renouvelée en ligne. Une carte Vitale n’expire pas et ne se renouvelle pas '
      + 'contre paiement. L’Assurance Maladie ne demande jamais de carte bancaire : en cas de '
      + 'doute, appelez le 3646.',
    lien: 'https://www.ameli.fr'
  },
  {
    id: 'renovation-demarchage',
    debut: '02-20', fin: '04-10',
    titre: 'Rénovation : les travaux « à 1 € » et le démarchage interdit',
    corps: 'Au retour des beaux jours, le démarchage reprend : isolation à 1 €, pompe à '
      + 'chaleur financée par l’État, aide qui expire demain. Le démarchage téléphonique pour '
      + 'la rénovation énergétique est interdit en France. Si on vous appelle pour ça, c’est '
      + 'déjà une infraction : raccrochez.'
  },
  {
    id: 'declaration-revenus',
    debut: '04-05', fin: '06-20',
    titre: 'Déclaration de revenus : la saison des faux messages du fisc',
    corps: 'Pendant la déclaration, les faux courriels « erreur sur votre déclaration » et '
      + '« remboursement en attente » se multiplient, aux couleurs de l’administration. '
      + 'Le fisc ne demande jamais vos identifiants par message. Passez toujours par '
      + 'impots.gouv.fr tapé vous-même dans le navigateur.',
    lien: 'https://www.impots.gouv.fr'
  },
  {
    id: 'vacances-location',
    debut: '06-15', fin: '08-15',
    titre: 'Vacances : fausses locations et fausses amendes',
    corps: 'L’été, deux pièges reviennent : l’annonce de location trop belle qu’on vous '
      + 'demande de régler par virement, et le faux avis d’amende ou de péage reçu par SMS. '
      + 'Ne réglez jamais une location par virement à un particulier, et vérifiez une amende '
      + 'uniquement sur antai.gouv.fr.',
    lien: 'https://www.antai.gouv.fr'
  }
];

// L'étiquette porte le mot « Despy » — list-alerts.js s'en sert pour laisser
// passer nos propres publications sans les repasser au filtre grand public,
// qui est calibré pour les flux institutionnels. Elle porte AUSSI le mot
// « Anticipation », car l'appli colorait en rouge « Vague détectée » tout ce
// qui vient de nous : afficher ça sur une fiche de saison affirmerait que nos
// membres se font avoir en ce moment, ce qui serait faux.
const ETIQUETTE = 'Despy · Anticipation';

// Une fenêtre peut enjamber le 31 décembre (Noël court jusqu'au 8 janvier).
// On cherche donc l'occurrence dans l'année en cours ET dans la précédente,
// sans quoi une fiche de décembre disparaîtrait le 1er janvier.
function occurrenceActive(fiche, maintenant) {
  const [md, mf] = [fiche.debut, fiche.fin];
  for (const annee of [maintenant.getUTCFullYear(), maintenant.getUTCFullYear() - 1]) {
    const debut = new Date(annee + '-' + md + 'T00:00:00Z');
    let fin = new Date(annee + '-' + mf + 'T23:59:59Z');
    if (fin < debut) fin = new Date((annee + 1) + '-' + mf + 'T23:59:59Z');
    if (maintenant >= debut && maintenant <= fin) return { debut, fin };
  }
  return null;
}

function fichesActives(maintenant) {
  const d = maintenant || new Date();
  return FICHES
    .map(f => ({ fiche: f, quand: occurrenceActive(f, d) }))
    .filter(x => x.quand)
    // Celle dont la fenêtre se referme le plus tôt passe devant : c'est celle
    // qui a le moins de temps pour encore servir à quelque chose. La rentrée
    // en août prime ainsi sur l'avis d'impôt, qui court jusqu'en octobre.
    .sort((a, b) => a.quand.fin - b.quand.fin);
}

// Ce qu'il reste à publier. Le dédoublonnage se fait sur le TITRE depuis
// l'ouverture de la fenêtre, et non sur l'URL comme pour les flux : nos fiches
// pointent vers une page officielle qui, elle, ne change pas d'une année sur
// l'autre. Dédoublonner par URL les aurait publiées une seule fois dans leur
// vie, ce qui vide de son sens un calendrier annuel.
//
// On n'en renvoie qu'une par passage : deux notifications le même matin, c'est
// une de trop pour quelqu'un qui doit encore savoir laquelle traiter.
async function fichesAPublier(supabase, maintenant) {
  const actives = fichesActives(maintenant);
  if (!actives.length) return [];

  for (const { fiche, quand } of actives) {
    const { data, error } = await supabase
      .from('national_alerts')
      .select('id')
      .eq('title', fiche.titre)
      .gte('created_at', quand.debut.toISOString())
      .limit(1);

    // En cas d'erreur base, on s'abstient : republier une fiche déjà envoyée
    // est pire que de sauter un passage — le prochain cron est dans 12 h.
    if (error) {
      console.error('[calendrier] base indisponible, publication reportée :', error.message);
      return [];
    }
    if (data && data.length) continue;

    return [{
      title: fiche.titre,
      body: fiche.corps,
      url: fiche.lien || null,
      source: ETIQUETTE,
      published: new Date().toISOString()
    }];
  }
  return [];
}

module.exports = { FICHES, ETIQUETTE, occurrenceActive, fichesActives, fichesAPublier };
