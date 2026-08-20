// lib/tiers.js — single source of truth for what each tier can do.
// Enforced server-side in campaigns-create.js. The client mirrors this for
// UI purposes only; the server never trusts the client's copy.

const TIERS = {
  free: {
    label: 'Free',
    totalCampaignCap: 3,       // lifetime cap
    dailyCap: null,
    maxPlatforms: 2,
    allowedPlatforms: ['x', 'facebook'],
    modules: ['platform_post', 'email_promo'],
  },
  starter: {
    label: 'Starter (Front-End)',
    totalCampaignCap: 20,      // lifetime cap, matches front-end-offer model
    dailyCap: 5,
    maxPlatforms: 5,
    allowedPlatforms: ['x', 'facebook', 'linkedin', 'threads'],
    modules: ['platform_post', 'email_promo', 'viral_hook', 'cta', 'video_hook'],
  },
  enterprise: {
    label: 'Enterprise',
    totalCampaignCap: null,    // unlimited
    dailyCap: null,
    maxPlatforms: 5,
    allowedPlatforms: ['x', 'facebook', 'linkedin', 'threads'],
    modules: ['platform_post', 'email_promo', 'viral_hook', 'cta', 'video_hook'],
  },
};

module.exports = { TIERS };
