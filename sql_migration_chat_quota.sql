-- ════════════════════════════════════════════
-- DESPY — Quota mensuel du Conseiller (comptes gratuits)
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- Avant : `questions_used` servait à la fois de compteur cumulatif ET de
-- quota — donc les 3 questions gratuites n'étaient JAMAIS réinitialisées
-- (3 questions à vie), alors que l'appli affichait « 5 questions ce mois ».
--
-- Après : `questions_used` reste le TOTAL cumulé (utilisé par le bilan, le
-- rapport mensuel et la séquence d'onboarding — à ne pas remettre à zéro),
-- et deux nouvelles colonnes portent le quota mensuel réellement remis à zéro :
--   chat_period      : mois en cours au format 'AAAA-MM'
--   chat_period_used : questions posées pendant ce mois
--
-- Sans cette migration, le Conseiller continue de fonctionner (dégradation
-- douce : on retombe sur le compteur cumulatif), mais sans reset mensuel.
-- ════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN IF NOT EXISTS chat_period      TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS chat_period_used INT DEFAULT 0;
