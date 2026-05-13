-- ════════════════════════════════════════════
-- DESPY — Migration : Sign in with Google
-- Ajoute la colonne google_id à la table clients
-- ════════════════════════════════════════════

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_clients_google_id ON clients(google_id);

-- Rendre password_hash optionnel (les comptes Google n'ont pas de mot de passe)
ALTER TABLE clients
  ALTER COLUMN password_hash DROP NOT NULL;
