-- ════════════════════════════════════════════
-- DESPY — Migration : mini-formation (nurture) des leads du guide
-- Ajoute à la table guide_leads le suivi de la séquence d'emails.
-- Alimentée par nurture-leads.js (cron quotidien).
-- À exécuter une fois dans l'éditeur SQL Supabase.
-- ════════════════════════════════════════════

-- Étape atteinte dans la séquence : 0 = a reçu le guide uniquement,
-- 1..4 = a reçu le nurture correspondant. La séquence s'arrête à 4.
ALTER TABLE guide_leads ADD COLUMN IF NOT EXISTS nurture_step INT DEFAULT 0;

-- Date du dernier email de nurture envoyé (pour espacer de 2 jours).
ALTER TABLE guide_leads ADD COLUMN IF NOT EXISTS nurture_last_at TIMESTAMPTZ;
