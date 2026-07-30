-- ════════════════════════════════════════════
-- DESPY — « L'arnaque du mois » : module de formation renouvelé chaque mois
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- Pourquoi : un contenu de formation FINI programme la fin de l'abonnement
-- (« j'ai tout fait, pourquoi je paie encore ? »). Les arnaques, elles, se
-- renouvellent en permanence — c'est une matière première inépuisable.
--
-- Le module est GÉNÉRÉ automatiquement le 1er du mois à partir des alertes
-- nationales et des signalements réels, puis reste en `draft` tant qu'un
-- humain n'a pas cliqué « Publier » dans l'email de validation.
-- Rien n'est jamais montré aux clients sans cette validation.
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS monthly_modules (
  id           BIGSERIAL PRIMARY KEY,
  period       TEXT NOT NULL UNIQUE,        -- 'AAAA-MM'
  title        TEXT NOT NULL,
  intro        TEXT,
  questions    JSONB NOT NULL,              -- [{q, opts[], answer, expl}]
  sources      JSONB,                       -- de quoi le module a été tiré (traçabilité)
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | published | rejected
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS monthly_modules_status_idx ON monthly_modules (status, period DESC);
