-- ════════════════════════════════════════════
-- DESPY — Notifs douces de réengagement (push) : suivi par membre
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- Ajoute deux colonnes à la table clients :
--   last_nudge_at : date de la dernière notif douce envoyée (plafond 1/semaine)
--   nudge_step    : compteur de rotation des messages (thème différent chaque semaine)
--
-- Sans cette migration, le cron nudge-push fonctionne quand même (dégradation
-- douce) mais envoie toujours le 1er message et ne mémorise pas la date.
-- Avec la migration : rotation complète + anti-doublon.
-- ════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS nudge_step    INT DEFAULT 0;
