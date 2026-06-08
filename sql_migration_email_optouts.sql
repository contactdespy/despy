-- ════════════════════════════════════════════
-- DESPY — Migration : désinscription des emails de conseils
-- Table dédiée, ISOLÉE du statut d'abonné payant (clients.subscribed).
-- Se désinscrire des conseils n'annule PAS l'abonnement.
-- Utilisée par weekly-report.js (filtre) et unsubscribe.js.
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_optouts (
  email TEXT PRIMARY KEY,
  scope TEXT DEFAULT 'weekly',   -- type d'email refusé (extensible)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
