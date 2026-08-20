// lib/tiers.js — single source of truth for what each tier can do.
// Enforced server-side in campaigns-create.js. The client mirrors this for
// UI purposes only; the server never trusts the client's copy.
//
// All tiers currently grant full access (unlimited campaigns, every
// platform, every module). The tier labels/keys are kept so licensing,
// keygen, and pricing display still work — but there are no functional
// restrictions attached to any of them right now. To reintroduce real
// limits later (e.g. once payment checkout is wired), just change the
// values below; nothing else needs to change.

const FULL_ACCESS = {
  totalCampaignCap: null,    // unlimited
  dailyCap: null,
  maxPlatforms: 5,
  allowedPlatforms: ['x', 'facebook', 'linkedin', 'threads'],
  modules: ['platform_post', 'email_promo', 'viral_hook', 'cta', 'video_hook', 'campaign_image'],
};

const TIERS = {
  free: { label: 'Free', ...FULL_ACCESS },
  starter: { label: 'Starter', ...FULL_ACCESS },
  enterprise: { label: 'Enterprise', ...FULL_ACCESS },
};

module.exports = { TIERS };
