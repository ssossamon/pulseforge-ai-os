-- PulseForge AI OS — v2.2: Zapier webhooks, team seats, social connections

-- Zapier: one outbound webhook URL per user. On every successful campaign
-- generation, the campaign + assets are POSTed here if configured.
CREATE TABLE IF NOT EXISTS zapier_webhooks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Team seats: a user can belong to another user's team (shared workspace).
-- When team_owner_id is set, all campaign reads/writes for that user operate
-- against the owner's account instead of their own.
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS team_invites (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  email TEXT,                 -- optional: restrict redemption to this email
  status TEXT NOT NULL DEFAULT 'pending', -- pending | redeemed | revoked
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMP,
  redeemed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Social account connections (BYO-account OAuth). Buyers connect their own
-- X/LinkedIn/etc accounts; the site itself must be registered as an OAuth
-- app with each platform (CLIENT_ID/CLIENT_SECRET env vars) for this to
-- activate — see README for setup.
CREATE TABLE IF NOT EXISTS social_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,     -- 'x' | 'linkedin'
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  platform_account_id TEXT,   -- e.g. LinkedIn member URN, needed at post time
  expires_at TIMESTAMP,
  account_label TEXT,         -- e.g. handle/display name, for the UI
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_team_invites_code ON team_invites(code);
CREATE INDEX IF NOT EXISTS idx_users_team_owner ON users(team_owner_id);
CREATE INDEX IF NOT EXISTS idx_social_connections_user ON social_connections(user_id);
