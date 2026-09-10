-- ════════════════════════════════════════════
-- DESPY — Savoir d'où viennent les clients
--
-- À exécuter dans l'éditeur SQL de Supabase. Réexécutable sans risque.
--
-- Le problème qu'il répare : jusqu'ici, une seule page du site savait d'où
-- venait un visiteur — `guide.html`, qui lit `fbclid` et étiquette la personne
-- `facebook_ads`. La page d'accueil, celle qui encaisse, ne le faisait pas.
-- Un visiteur venu d'une publicité Meta et devenu abonné était donc
-- rigoureusement indiscernable d'un visiteur venu du bouche-à-oreille.
--
-- Conséquence : on pouvait dépenser en publicité pendant des semaines sans
-- jamais pouvoir répondre à « est-ce que ça a rapporté un seul client ? ».
-- Pire, le seul compteur qui existait (« venus de la publicité ») interrogeait
-- la table des téléchargements du guide : il valait zéro en permanence dès que
-- la publicité pointait ailleurs que sur /guide — un zéro qui ne prouvait rien
-- et qu'on aurait lu comme « la publicité n'amène personne ».
--
-- Ce que la colonne contient : une ÉTIQUETTE de canal, jamais un identifiant
-- de clic. `facebook_ads`, `facebook_organique`, `google`, ou la valeur
-- d'`utm_source` nettoyée. Le `fbclid` lui-même n'est ni transmis ni stocké :
-- on veut compter, pas suivre les gens.
--
-- NULL = compte créé avant la mise en place de la mesure, ou origine inconnue.
-- Le tableau de bord les affiche sous « Direct / inconnu ». On ne les réécrit
-- pas : inventer une origine qu'on n'a pas mesurée reviendrait à se mentir.
-- ════════════════════════════════════════════

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS provenance TEXT;

-- Le tableau de bord regroupe par canal sur toute la table, et l'écriture se
-- fait une seule fois par compte (à la création). Un index simple suffit.
CREATE INDEX IF NOT EXISTS idx_clients_provenance
  ON clients (provenance)
  WHERE provenance IS NOT NULL;

-- ── Contrôle ────────────────────────────────────────────────────────────
-- Juste après la migration : une seule ligne, « (vide → direct/inconnu) »,
-- avec le total des comptes existants. C'est normal — rien n'a encore été
-- mesuré. La première ligne `facebook_ads` apparaîtra au premier compte créé
-- par quelqu'un venu d'une publicité, une fois le site redéployé.
SELECT COALESCE(provenance, '(vide → direct/inconnu)') AS canal,
       count(*)                                        AS comptes,
       count(*) FILTER (WHERE subscribed)              AS abonnes
FROM clients
GROUP BY 1
ORDER BY 2 DESC;
