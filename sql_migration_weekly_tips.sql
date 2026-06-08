-- ════════════════════════════════════════════
-- DESPY — Migration : suivi des conseils hebdomadaires
-- Table de progression : quel abonné a reçu / accompli quel conseil.
-- Utilisée par weekly-report.js (envoi + log) et tip-done.js (validation).
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS weekly_tip_log (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  tip_id TEXT NOT NULL,          -- id stable du conseil (ex: '2fa-email')
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,      -- rempli quand l'abonné clique « C'est fait »
  UNIQUE (email, tip_id)         -- une ligne par abonné et par conseil
);

CREATE INDEX IF NOT EXISTS idx_weekly_tip_log_email ON weekly_tip_log(email);
CREATE INDEX IF NOT EXISTS idx_weekly_tip_log_completed ON weekly_tip_log(completed_at);
