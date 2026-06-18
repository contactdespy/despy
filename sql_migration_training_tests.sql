-- ════════════════════════════════════════════
-- DESPY — Migration : entraînement anti-arnaque (tests de phishing opt-in)
-- Stocke chaque test envoyé et s'il a été cliqué. Aucune donnée sensible.
-- Alimentée par training-send.js (envoi) et training-click.js (clic + débrief).
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS training_tests (
  token                 TEXT PRIMARY KEY,
  email                 TEXT NOT NULL,
  prenom                TEXT,
  template_id           TEXT,
  trusted_contact_email TEXT,
  trusted_contact_name  TEXT,
  sent_at               TIMESTAMPTZ DEFAULT NOW(),
  clicked_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_training_email ON training_tests (email);
