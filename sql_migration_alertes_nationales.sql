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

-- L'URL identifie l'alerte : c'est sur elle que le robot vérifie s'il a déjà
-- vu la nouvelle. Sans unicité, un doublon ferait échouer la lecture
-- `.maybeSingle()` du robot, qui exige au plus une ligne.
CREATE UNIQUE INDEX IF NOT EXISTS idx_national_alerts_url
  ON national_alerts (url)
  WHERE url IS NOT NULL;

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
