-- ════════════════════════════════════════════
-- DESPY — Historique des demandes SOS
-- À exécuter une fois dans Supabase (SQL Editor).
--
-- `sos-request.js` écrit dans cette table depuis le début, mais elle n'a
-- jamais été créée : l'insertion échouait à chaque fois, silencieusement
-- (« Supabase insert failed (table may not exist) » dans les logs). Les
-- alertes partaient bien — Telegram, email, personne de confiance — mais
-- aucun registre n'était conservé : impossible de savoir qui a appelé à
-- l'aide, quand, ni pour quel motif.
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sos_requests (
  id           BIGSERIAL PRIMARY KEY,
  user_email   TEXT,
  type         TEXT NOT NULL,          -- paiement | compte | infos | appels | doute
  type_label   TEXT,
  is_critical  BOOLEAN DEFAULT FALSE,
  phone        TEXT,
  context      TEXT,
  subscribed   BOOLEAN DEFAULT FALSE,
  paid_one_off BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Retrouver l'historique d'une personne, et les demandes récentes
CREATE INDEX IF NOT EXISTS sos_email_idx   ON sos_requests (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS sos_recent_idx  ON sos_requests (created_at DESC);

-- La table contient des numéros de téléphone et le récit de personnes en
-- difficulté. Seule la clé service (fonctions Netlify) doit y accéder.
ALTER TABLE sos_requests ENABLE ROW LEVEL SECURITY;

-- Vérification : 3 index attendus, rls_active = true.
SELECT indexname FROM pg_indexes WHERE tablename = 'sos_requests';
SELECT relrowsecurity AS rls_active FROM pg_class WHERE relname = 'sos_requests';
