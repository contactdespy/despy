-- ════════════════════════════════════════════
-- DESPY — Signaler un prélèvement qui n'est pas passé
--
-- Jusqu'ici, un échec de paiement ne laissait AUCUNE trace en base : le
-- serveur envoyait un email et s'arrêtait là. Ni le site ni l'application ne
-- pouvaient donc prévenir le client — ils ne le savaient pas.
--
-- Cette colonne porte la DATE du premier échec (NULL = tout va bien). Une
-- date plutôt qu'un booléen : elle dit aussi depuis combien de temps ça dure,
-- ce qui servira si un jour on veut relancer ou couper au bout de X jours.
--
-- À exécuter dans l'éditeur SQL de Supabase. Sans elle, rien ne casse : le
-- code fonctionne en dégradé (aucun bandeau, comportement d'avant).
-- ════════════════════════════════════════════

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS payment_issue_at TIMESTAMPTZ;

-- Un index partiel : on ne cherche jamais que les quelques comptes en défaut,
-- pas les milliers qui vont bien.
CREATE INDEX IF NOT EXISTS idx_clients_paiement_defaut
  ON clients (payment_issue_at)
  WHERE payment_issue_at IS NOT NULL;

-- Contrôle : doit renvoyer une ligne.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'clients' AND column_name = 'payment_issue_at';
