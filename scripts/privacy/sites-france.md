# Privacy Cleanup — Sites français où chercher et supprimer les données d'un client

> Mode d'emploi : pour chaque client, parcourir la liste de haut en bas.
> Beaucoup de sites ont un formulaire de suppression direct (le plus rapide).
> Sinon : email RGPD article 17 (gabarit dans `template-rgpd-art17.md`).
> Temps constaté : ~30 min le premier client, ~10 min les suivants.

## 1. Annuaires téléphoniques (prioritaires — c'est là qu'on trouve le plus)

| Site | Comment supprimer | Notes |
|---|---|---|
| PagesJaunes / PagesBlanches (pagesjaunes.fr) | Formulaire : pagesjaunes.fr → fiche → « Signaler un abus » ou solocal.com/rgpd | Le plus consulté de France |
| 118218.fr | Email RGPD → service-client@118218.fr | |
| 118712.fr (Orange) | Formulaire de contact 118712 ou email RGPD | |
| 118000.fr | Formulaire « supprimer mes données » en bas de fiche | |
| annuaire.com | Email RGPD via mentions légales | |
| nom-prenom.fr / annuaires de personnes | Email RGPD | Vérifier au cas par cas |

## 2. Moteurs de recherche de personnes / agrégateurs

| Site | Comment supprimer | Notes |
|---|---|---|
| Google (résultats) | « Résultats vous concernant » : myactivity.google.com/results-about-you — demande de retrait des résultats contenant tél/adresse | Ne supprime pas la source, mais déréférence |
| Bing | bing.com → formulaire « Signaler un problème » | |
| Webmii, Yasni, 123people-like | Email RGPD si fiche présente | Souvent vides pour les particuliers FR |

## 3. Sites d'avis / réseaux professionnels résiduels

| Site | Comment supprimer | Notes |
|---|---|---|
| Societe.com / Pappers / Infogreffe | Si le client a été dirigeant/EI : demande de confidentialité de l'adresse via formulaire | Données légales : suppression partielle seulement |
| LinkedIn / Facebook / Instagram publics | Guider le client pour passer son profil en privé | On ne peut pas le faire à sa place |
| Copains d'avant | Suppression de compte via le site ou email RGPD | Très fréquent pour les 50+ |

## 4. Data brokers internationaux (rarement pertinents pour un particulier FR, vérifier vite)

| Site | Comment supprimer |
|---|---|
| Spokeo | spokeo.com/optout |
| BeenVerified | beenverified.com/app/optout/search |
| Whitepages | whitepages.com/suppression-requests |
| MyLife | privacy@mylife.com (RGPD/CCPA) |

## 5. Fuites & republication (vérifié automatiquement par Despy)

- HIBP + Hudson Rock tournent déjà chaque semaine pour tous les abonnés — rien à faire ici.

## Suivi

Après traitement : mettre à jour la ligne du client dans Supabase → table `privacy_requests`
(`status` : `pending` → `in_progress` → `done`, et noter dans `notes` les sites où une demande a été envoyée).
Le client voit la progression dans son espace.
