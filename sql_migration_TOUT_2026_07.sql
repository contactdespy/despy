-- ════════════════════════════════════════════
-- DESPY — Les 3 migrations en attente (juillet 2026), regroupées
-- À coller d'un bloc dans Supabase → SQL Editor → Run.
--
-- Sans exécution, rien ne casse : les fonctions concernées se mettent
-- simplement en veille (quota du Conseiller sans remise à zéro, carte
-- « arnaque du mois » masquée, écran d'entraînement en « bientôt disponible »).
-- Tout est réexécutable sans risque (IF NOT EXISTS partout).
-- ════════════════════════════════════════════

-- 1) Quota mensuel du Conseiller (comptes gratuits)
--    questions_used reste le CUMUL (bilan, rapport mensuel, onboarding) ;
--    le quota vit à part et se remet à zéro chaque mois.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS chat_period      TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS chat_period_used INT DEFAULT 0;

-- 2) « L'arnaque du mois » : module de formation renouvelé chaque mois.
--    Créé en brouillon par le cron, publié seulement après votre validation.
CREATE TABLE IF NOT EXISTS monthly_modules (
  id           BIGSERIAL PRIMARY KEY,
  period       TEXT NOT NULL UNIQUE,        -- 'AAAA-MM'
  title        TEXT NOT NULL,
  intro        TEXT,
  questions    JSONB NOT NULL,
  sources      JSONB,
  status       TEXT NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS monthly_modules_status_idx ON monthly_modules (status, period DESC);

-- 3) Entraînement grandeur nature : tests surprises récurrents (opt-in).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS training_active  BOOLEAN DEFAULT FALSE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS training_rythme  TEXT DEFAULT 'mensuel';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS training_last_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS clients_training_idx ON clients (training_active, training_last_at);
