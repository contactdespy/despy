-- ════════════════════════════════════════════
-- DESPY — Offre Famille : les proches rattachés à l'abonnement
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- Jusqu'ici l'offre Famille était VENDUE mais pas livrée : « family_monthly »
-- n'existait que comme prix Stripe et libellé d'email. Un abonné payait 14,99 €
-- pour exactement ce qu'un solo obtient à 9,99 €. Cette table est le chaînon
-- manquant.
--
-- Principe : le payeur (owner) invite jusqu'à 2 proches. Chacun crée son
-- propre compte Despy, saisit le code reçu, et bénéficie alors de toutes les
-- protections tant que l'abonnement du payeur est actif.
-- Total : 3 personnes — le payeur et ses deux invités.
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS family_members (
  id           BIGSERIAL PRIMARY KEY,
  owner_email  TEXT NOT NULL,              -- celui qui paie
  member_email TEXT,                       -- renseigné à l'acceptation
  code         TEXT NOT NULL UNIQUE,       -- code d'invitation, à usage unique
  status       TEXT NOT NULL DEFAULT 'invited',   -- invited | active | revoked
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ
);

-- Retrouver vite les invitations d'un payeur, et la couverture d'un membre
CREATE INDEX IF NOT EXISTS family_owner_idx  ON family_members (owner_email, status);
CREATE INDEX IF NOT EXISTS family_member_idx ON family_members (member_email, status);

-- Une même personne ne peut pas être rattachée deux fois activement
CREATE UNIQUE INDEX IF NOT EXISTS family_member_unique
  ON family_members (member_email) WHERE status = 'active';

-- ── Verrouillage ──
-- Aucune clé Supabase n'est exposée au navigateur (tout passe par les
-- fonctions Netlify avec la clé service, qui contourne RLS par conception).
-- On active quand même RLS sans aucune policy : la table ne contient que des
-- adresses email de clients, et si un jour du code côté navigateur parlait à
-- Supabase, elle resterait fermée.
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

-- ── Vérification ──
-- Doit renvoyer 3 lignes (les 3 index) et rls_active = true.
SELECT indexname FROM pg_indexes WHERE tablename = 'family_members';
SELECT relrowsecurity AS rls_active FROM pg_class WHERE relname = 'family_members';
