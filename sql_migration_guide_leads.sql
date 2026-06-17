-- ════════════════════════════════════════════
-- DESPY — Migration : aimant à leads (guide PDF "5 arnaques qui visent vos parents")
-- Table dédiée, ISOLÉE de la table clients (un lead n'est PAS un compte).
-- Alimentée par guide-lead.js depuis la landing page /guide.
-- Sert à : recibler les prospects et mesurer la conversion des pubs Facebook.
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guide_leads (
  email       TEXT PRIMARY KEY,
  prenom      TEXT,
  source      TEXT DEFAULT 'guide_5_arnaques',  -- d'où vient le lead (extensible)
  relance_sent BOOLEAN DEFAULT FALSE,           -- pour une future relance email
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
