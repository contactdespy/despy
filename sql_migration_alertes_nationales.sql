-- ════════════════════════════════════════════
-- DESPY — Les deux tables des alertes nationales
--
-- Pourquoi cette migration existe : le code écrit dans `national_alerts` et
-- `sent_alerts` depuis des mois, mais AUCUN fichier du dépôt ne les crée. Si
-- elles n'ont jamais été créées à la main dans Supabase, chaque insertion
-- échouait — en silence, car l'erreur n'était pas lue — et `list-alerts`
-- renvoyait un tableau vide impossible à distinguer d'un « tout va bien ».
-- L'appli affichait donc « Aucune alerte en cours. Tant mieux ! » en
-- permanence.
--
-- Tout est en IF NOT EXISTS : si les tables existent déjà, ce script ne
-- change rien et ne casse rien. À exécuter dans l'éditeur SQL de Supabase.
-- ════════════════════════════════════════════

-- ── Ce que l'appli affiche ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS national_alerts (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT,
  source      TEXT,
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- L'URL identifie une alerte VENUE D'UNE SOURCE EXTERNE : c'est sur elle que
-- le robot vérifie s'il a déjà vu le communiqué de la CNIL ou de l'ANSSI.
--
-- Mais elle n'identifie PAS nos propres publications, et l'index d'origine les
-- aurait purement et simplement refusées :
--
--   • toutes les vagues détectées chez nos membres pointent vers la même page
--     d'alertes — la première insérée aurait bloqué toutes les suivantes ;
--   • trois fiches de saison mènent à impots.gouv.fr (avis d'impôt, taxe
--     foncière, déclaration de revenus) : deux n'auraient jamais pu paraître ;
--   • une fiche de saison se republie CHAQUE ANNÉE, vers le même site
--     officiel. L'unicité l'aurait figée à une seule parution dans la vie du
--     service, ce qui vide de son sens l'idée même d'un calendrier annuel.
--
-- Nos publications se dédoublonnent par TITRE, en amont, dans leur module. La
-- contrainte ne porte donc que sur ce qu'elle sait identifier : les sources
-- externes. Le partiel `source NOT LIKE 'Despy%'` fait exactement ça.
--
-- On efface d'abord les doublons éventuels (on garde le plus récent), sinon
-- la création de l'index unique échouerait et tout le script s'arrêterait là.
DELETE FROM national_alerts a
  USING national_alerts b
  WHERE a.url IS NOT NULL
    AND COALESCE(a.source, '') NOT LIKE 'Despy%'
    AND COALESCE(b.source, '') NOT LIKE 'Despy%'
    AND a.url = b.url
    AND a.id < b.id;

-- L'ancien index couvrait TOUTES les lignes. `IF NOT EXISTS` ne l'aurait pas
-- corrigé — il aurait vu un index du même nom et n'aurait rien fait. On le
-- supprime donc explicitement avant de le recréer dans sa forme restreinte.
DROP INDEX IF EXISTS idx_national_alerts_url;

CREATE UNIQUE INDEX idx_national_alerts_url
  ON national_alerts (url)
  WHERE url IS NOT NULL AND COALESCE(source, '') NOT LIKE 'Despy%';

-- L'appli demande toujours les plus récentes en premier.
CREATE INDEX IF NOT EXISTS idx_national_alerts_date
  ON national_alerts (created_at DESC);

-- ── Ce qui est déjà parti par email ─────────────────────────────────────
-- Table distincte de la précédente à dessein : une alerte peut être affichée
-- dans l'appli sans avoir été envoyée par email (trop ancienne, ou plafond
-- d'un envoi par passage). Mélanger les deux ferait perdre cette nuance.
CREATE TABLE IF NOT EXISTS sent_alerts (
  id           BIGSERIAL PRIMARY KEY,
  alert_url    TEXT,
  alert_title  TEXT,
  source       TEXT,
  recipients   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DELETE FROM sent_alerts a
  USING sent_alerts b
  WHERE a.alert_url IS NOT NULL
    AND a.alert_url = b.alert_url
    AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_alerts_url
  ON sent_alerts (alert_url)
  WHERE alert_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sent_alerts_date
  ON sent_alerts (created_at DESC);

-- ── Contrôle ────────────────────────────────────────────────────────────
-- Doit renvoyer deux lignes : national_alerts et sent_alerts.
SELECT table_name,
       (SELECT count(*) FROM information_schema.columns c
         WHERE c.table_name = t.table_name) AS colonnes
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('national_alerts', 'sent_alerts')
ORDER BY table_name;
