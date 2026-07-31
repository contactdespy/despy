-- ════════════════════════════════════════════
-- DESPY — Entraînement récurrent : « on ne finit jamais de s'entraîner »
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- Pourquoi : la formation en modules se termine — l'entraînement, non.
-- Un faux message-test envoyé à intervalles réguliers, en conditions réelles,
-- entretient le réflexe bien mieux qu'un quiz, et se répète indéfiniment.
--
-- 3 colonnes sur clients :
--   training_active  : le membre a activé l'entraînement (opt-in strict)
--   training_rythme  : mensuel | bimestriel | trimestriel
--   training_last_at : date du dernier test envoyé (pilote la récurrence)
--
-- Sans cette migration, le cron ne trouve personne et ne fait rien
-- (dégradation douce), et l'écran de réglage affiche un état neutre.
-- ════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN IF NOT EXISTS training_active  BOOLEAN DEFAULT FALSE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS training_rythme  TEXT DEFAULT 'mensuel';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS training_last_at TIMESTAMPTZ;

-- Retrouver rapidement les membres à entraîner
CREATE INDEX IF NOT EXISTS clients_training_idx ON clients (training_active, training_last_at);
