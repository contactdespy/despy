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
