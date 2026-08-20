-- PulseForge AI OS — v2.1 enhancements
-- Brand voice profiles, reusable campaign templates, multi-language +
-- compliance-check support on campaigns.

CREATE TABLE IF NOT EXISTS brand_voices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tone_notes TEXT,           -- free-text description of the voice
  signature_phrases TEXT,    -- phrases/words to favor
  banned_words TEXT,         -- phrases/words to avoid
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  offer_url TEXT,
  target_audience TEXT,
  main_benefit TEXT,
  tone TEXT,
  language TEXT DEFAULT 'en',
  platforms TEXT[] NOT NULL DEFAULT '{}',
  asset_modules TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS voice_id INTEGER REFERENCES brand_voices(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS compliance_notes TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_brand_voices_user ON brand_voices(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user ON campaign_templates(user_id);
