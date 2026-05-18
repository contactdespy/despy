-- ════════════════════════════════════════════
-- DESPY — Migration : Dashboard admin groupes Facebook
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fb_groups (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL, -- 'anti-arnaque' | 'seniors' | 'famille' | 'local' | 'retraite'
  facebook_url TEXT,
  estimated_size INT,
  status TEXT DEFAULT 'pending_join', -- 'pending_join' | 'joined' | 'banned' | 'left'
  notes TEXT,
  joined_at TIMESTAMPTZ,
  last_post_at TIMESTAMPTZ,
  posts_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fb_group_posts (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT REFERENCES fb_groups(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  posted_at TIMESTAMPTZ DEFAULT NOW(),
  views INT,
  clicks INT,
  comments INT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_fb_groups_status ON fb_groups(status);
CREATE INDEX IF NOT EXISTS idx_fb_groups_category ON fb_groups(category);
CREATE INDEX IF NOT EXISTS idx_fb_group_posts_group ON fb_group_posts(group_id);

-- ── Seed des 18 groupes stratégiques ──
INSERT INTO fb_groups (name, category, estimated_size) VALUES
  ('Stop aux arnaques en France',         'anti-arnaque', 60000),
  ('Signaler une arnaque (France)',       'anti-arnaque', 40000),
  ('Halte aux arnaques Internet',         'anti-arnaque', 30000),
  ('Victimes d''arnaques en ligne France','anti-arnaque', 15000),
  ('Seniors connectés',                   'seniors',      40000),
  ('Aide informatique pour seniors',      'seniors',      18000),
  ('Génération senior',                   'seniors',      22000),
  ('Sénior magazine',                     'seniors',      20000),
  ('Grands-parents connectés',            'famille',      15000),
  ('Mamie / Papi geek',                   'famille',      10000),
  ('Familles 2.0',                        'famille',       8000),
  ('Strasbourg entre nous',               'local',        75000),
  ('Habitants de l''Eurométropole',       'local',        30000),
  ('Schiltigheim - Bischheim - Lingolsheim','local',      10000),
  ('Annonces Bas-Rhin',                   'local',        35000),
  ('Strasbourg & Co (entraide)',          'local',        20000),
  ('Préparer sa retraite',                'retraite',     12000),
  ('Conseil aux retraités',               'retraite',     10000)
ON CONFLICT (name) DO NOTHING;
