-- PulseForge AI OS — v2.4: tracked links attached to campaigns.
-- Original implementation: link rotation, weighted split testing with
-- cookie-based conversion attribution, click logging, CSV-importable
-- destination variants.

CREATE TABLE IF NOT EXISTS tracked_links (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  mode TEXT NOT NULL DEFAULT 'single',        -- single | rotate | weighted | split
  auto_declare BOOLEAN NOT NULL DEFAULT FALSE,
  min_conversions_to_declare INT NOT NULL DEFAULT 20,
  winner_destination_id INTEGER,
  current_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracked_link_destinations (
  id SERIAL PRIMARY KEY,
  tracked_link_id INTEGER NOT NULL REFERENCES tracked_links(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  weight INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  click_count BIGINT NOT NULL DEFAULT 0,
  conversion_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracked_link_clicks (
  id SERIAL PRIMARY KEY,
  tracked_link_id INTEGER NOT NULL REFERENCES tracked_links(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES tracked_link_destinations(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  referer TEXT NOT NULL DEFAULT '',
  clicked_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Short-lived visit record so a later conversion pixel/webhook can be
-- attributed back to the destination variant that visitor was actually sent
-- to — this is what makes auto-declare meaningful (real conversion rate,
-- not just click volume).
CREATE TABLE IF NOT EXISTS tracked_link_visits (
  id SERIAL PRIMARY KEY,
  visit_token TEXT UNIQUE NOT NULL,
  tracked_link_id INTEGER NOT NULL REFERENCES tracked_links(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES tracked_link_destinations(id) ON DELETE CASCADE,
  converted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_links_user ON tracked_links(user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_links_campaign ON tracked_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracked_link_slug ON tracked_links(slug);
CREATE INDEX IF NOT EXISTS idx_destinations_link ON tracked_link_destinations(tracked_link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_link ON tracked_link_clicks(tracked_link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON tracked_link_clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_visits_token ON tracked_link_visits(visit_token);
