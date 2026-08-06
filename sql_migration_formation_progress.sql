-- ════════════════════════════════════════════
-- DESPY — Progression de la formation, enfin conservée
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- Jusqu'ici les 10 modules étaient cochés UNIQUEMENT dans le localStorage du
-- téléphone (despy_module_1..10). Changement d'appareil, cache vidé, ou
-- passage par le site : toute la formation disparaissait, sans prévenir.
-- Pour un abonné qui avait fait 7 modules, c'est son travail qui s'efface.
--
-- Stocké en TEXTE (« 1,3,7 ») plutôt qu'en tableau : une colonne simple,
-- lisible à l'œil dans Supabase, et fusionnable sans risque avec l'état local.
-- ════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN IF NOT EXISTS modules_done TEXT;

-- Vérification : la colonne doit apparaître.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'clients' AND column_name = 'modules_done';
