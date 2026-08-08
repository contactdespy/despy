-- ════════════════════════════════════════════
-- DESPY — Le mot de passe famille
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- Despy ENSEIGNE cette parade depuis toujours : « convenez d'un mot secret
-- en famille » est la bonne réponse de deux quiz de la formation. Mais
-- l'application ne la FOURNISSAIT nulle part — le client apprenait le bon
-- réflexe, puis devait se débrouiller seul.
--
-- Avec le clonage de voix par IA (quelques secondes suffisent), c'est
-- devenu la seule parade fiable contre « mamie c'est moi, j'ai eu un
-- accident, envoie de l'argent ». Une voix s'imite ; un mot convenu, non.
--
-- Le mot est stocké en clair À DESSEIN : il doit pouvoir être affiché au
-- client ET envoyé à sa personne de confiance. Ce n'est pas un secret
-- d'authentification, c'est un code de reconnaissance partagé.
-- ════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN IF NOT EXISTS family_word TEXT;

-- Vérification : la colonne doit apparaître.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'clients' AND column_name = 'family_word';
