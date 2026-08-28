-- ════════════════════════════════════════════
-- DESPY — La file de validation de la veille presse
--
-- À exécuter dans l'éditeur SQL de Supabase, APRÈS
-- sql_migration_alertes_nationales.sql (qui crée la table elle-même).
--
-- Ce que ça change : jusqu'ici, tout ce qui entrait dans `national_alerts`
-- était publié. C'était tenable tant que les sources étaient la CNIL, l'ANSSI
-- et Cybermalveillance — trois institutions qui ne se trompent pas de sujet.
-- La veille lit maintenant aussi la presse, où l'on trouve le meilleur (« Deux
-- seniors victimes d'une arnaque téléphonique à Strasbourg ») et l'inutile
-- (la villa d'Enrico Macias). Un article de presse ne doit donc PAS paraître
-- sans qu'un humain l'ait lu.
--
-- D'où deux colonnes, et une règle qui compte plus que les deux :
-- l'ABSENCE de statut vaut « publié ». Les alertes déjà en base n'en ont pas ;
-- si le vide valait « à valider », elles disparaîtraient toutes de l'appli à
-- la seconde du déploiement. Le code lit donc partout
-- « status IS NULL OR status = 'publie' ».
--
-- Tout est en IF NOT EXISTS : réexécutable sans risque.
-- ════════════════════════════════════════════

-- ── Les deux colonnes ───────────────────────────────────────────────────
-- 'publie'    : visible dans l'appli et sur le site ;
-- 'a_valider' : en attente d'un clic humain, invisible ;
-- 'rejete'    : lu et écarté, invisible, conservé pour ne pas le reproposer.
ALTER TABLE national_alerts
  ADD COLUMN IF NOT EXISTS status TEXT;

-- 'officiel' (CNIL, ANSSI, Cybermalveillance), 'presse', ou 'despy' pour nos
-- propres publications (vagues internes, fiches de saison).
ALTER TABLE national_alerts
  ADD COLUMN IF NOT EXISTS confiance TEXT;

-- ── Les lignes déjà présentes ───────────────────────────────────────────
-- Elles viennent toutes des sources officielles ou de nous : on les nomme,
-- sans toucher à leur statut (qui reste NULL, donc publié). Écrit avec un
-- WHERE sur la colonne vide pour rester rejouable sans écraser un classement
-- fait à la main plus tard.
UPDATE national_alerts
   SET confiance = CASE WHEN COALESCE(source, '') LIKE 'Despy%' THEN 'despy'
                        ELSE 'officiel' END
 WHERE confiance IS NULL;

-- ── L'index qui sert à l'affichage ──────────────────────────────────────
-- list-alerts demande « les publiées, les plus récentes d'abord ». Sans
-- index partiel, Postgres lirait aussi la file d'attente pour la jeter
-- ensuite — et cette file est la partie qui grossit le plus vite (une
-- vingtaine d'articles par jour contre quelques-uns par trimestre).
CREATE INDEX IF NOT EXISTS idx_national_alerts_publiees
  ON national_alerts (created_at DESC)
  WHERE status IS NULL OR status = 'publie';

-- Le robot cherche « ce qui attend » pour le rappeler dans le récapitulatif.
CREATE INDEX IF NOT EXISTS idx_national_alerts_attente
  ON national_alerts (created_at DESC)
  WHERE status = 'a_valider';

-- ── L'unicité, revue ────────────────────────────────────────────────────
-- L'index posé par la migration précédente couvre « url IS NOT NULL AND
-- source NOT LIKE 'Despy%' ». La presse rentre dans ce périmètre, et c'est
-- voulu : deux articles de presse partageant une URL sont le même article.
-- Rien à changer ici — cette note existe pour qu'on n'ait pas à le revérifier.

-- ── Contrôle ────────────────────────────────────────────────────────────
-- Doit renvoyer une ligne par statut. Après la migration et avant le premier
-- passage du robot : une seule ligne, status NULL, confiance 'officiel'
-- ou 'despy'. Aucune ligne ne doit être invisible sans qu'on l'ait voulu.
SELECT COALESCE(status, '(vide → publié)') AS statut,
       COALESCE(confiance, '(vide)')       AS confiance,
       count(*)                            AS lignes
FROM national_alerts
GROUP BY 1, 2
ORDER BY 3 DESC;
