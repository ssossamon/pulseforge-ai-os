-- PulseForge AI OS — v2.3: built-in starter templates
-- Templates with user_id = NULL are shared/global "built-in" starters,
-- visible to every account alongside their own saved templates.

ALTER TABLE campaign_templates ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE campaign_templates ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT FALSE;

-- Idempotent seed: only insert if no built-ins exist yet (safe to re-run).
INSERT INTO campaign_templates (user_id, name, offer_url, target_audience, main_benefit, tone, language, platforms, asset_modules, is_builtin)
SELECT * FROM (VALUES
  (NULL::INTEGER, 'Product Launch', '', 'people who follow you but haven''t bought yet', 'the single biggest reason this is worth trying today', 'direct', 'en', ARRAY['x','facebook','linkedin','threads'], ARRAY['platform_post','email_promo','viral_hook','cta'], TRUE),
  (NULL::INTEGER, 'Weekly Promo / Discount', '', 'past customers and warm leads', 'limited-time savings, ends soon', 'playful', 'en', ARRAY['x','facebook','threads'], ARRAY['platform_post','email_promo','cta'], TRUE),
  (NULL::INTEGER, 'Webinar / Live Training Invite', '', 'people interested in the topic but who haven''t attended a live session before', 'a free, specific outcome they''ll walk away with', 'authority', 'en', ARRAY['x','facebook','linkedin'], ARRAY['platform_post','email_promo','viral_hook','video_hook'], TRUE),
  (NULL::INTEGER, 'Affiliate Offer Promotion', '', 'your list/followers who trust your recommendations', 'why this specific offer over the dozen similar ones', 'direct', 'en', ARRAY['x','facebook','threads'], ARRAY['platform_post','email_promo','cta'], TRUE),
  (NULL::INTEGER, 'Course / Training Launch', '', 'people stuck at the skill level right before this course starts', 'the transformation from before to after taking it', 'story', 'en', ARRAY['x','facebook','linkedin','threads'], ARRAY['platform_post','email_promo','viral_hook','cta','video_hook'], TRUE),
  (NULL::INTEGER, 'Free Lead Magnet Giveaway', '', 'cold traffic who don''t know you yet', 'genuinely useful and free, no pitch attached', 'playful', 'en', ARRAY['x','facebook','linkedin','threads'], ARRAY['platform_post','email_promo','viral_hook'], TRUE)
) AS seed(user_id, name, offer_url, target_audience, main_benefit, tone, language, platforms, asset_modules, is_builtin)
WHERE NOT EXISTS (SELECT 1 FROM campaign_templates WHERE is_builtin = TRUE);
