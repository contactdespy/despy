-- ════════════════════════════════════════════
-- DESPY — Migration : surveillance « appareil infecté » (infostealer)
-- Ajoute à la table clients le suivi des infections détectées par Hudson Rock.
-- Alimentée par hudsonrock-check.js (cron mensuel le 15 + vérif à la demande).
--
-- À exécuter une fois dans l'éditeur SQL Supabase.
-- ════════════════════════════════════════════

-- Date de la dernière vérification infostealer
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_stealer_check TIMESTAMPTZ;

-- Empreintes des infections déjà connues (pour ne PAS réalerter chaque mois)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS known_stealers TEXT[] DEFAULT '{}';

-- Nombre d'appareils infectés détectés à la dernière vérification
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stealer_count INT DEFAULT 0;
