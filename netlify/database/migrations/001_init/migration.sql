-- PulseForge AI OS — initial schema
-- Applied automatically by Netlify DB before each deploy.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS license_keys (
  id SERIAL PRIMARY KEY,
  key_value TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused',
  created_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  redeemed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  offer_url TEXT,
  target_audience TEXT,
  main_benefit TEXT,
  tone TEXT,
  platforms TEXT[] NOT NULL DEFAULT '{}',
  asset_modules TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  module TEXT NOT NULL,          -- e.g. platform_post, viral_hook, cta, video_hook, email_promo
  platform TEXT,                 -- e.g. x, facebook, linkedin, threads (null for non-platform modules)
  label TEXT NOT NULL,           -- display label, e.g. "X Post #1"
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  source TEXT,
  tag TEXT,
  synced_to_kit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_campaign ON assets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_keys_status ON license_keys(status);
CREATE INDEX IF NOT EXISTS idx_leads_synced ON leads(synced_to_kit);
