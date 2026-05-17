-- ════════════════════════════════════════════
-- DESPY — Migration : Agent IA Facebook
-- ════════════════════════════════════════════

-- Cache du Page Access Token (permanent une fois obtenu)
CREATE TABLE IF NOT EXISTS facebook_tokens (
  page_id TEXT PRIMARY KEY,
  page_access_token TEXT NOT NULL,
  long_lived_user_token TEXT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log de tous les posts générés (preview, publié, échec)
CREATE TABLE IF NOT EXISTS social_posts (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'facebook',
  post_type TEXT NOT NULL,
  content TEXT NOT NULL,
  facebook_post_id TEXT,
  status TEXT DEFAULT 'pending',     -- pending | preview | published | failed
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC);
