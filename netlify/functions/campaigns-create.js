// netlify/functions/campaigns-create.js — manual campaign builder endpoint.
// Enforces tier limits SERVER-SIDE, calls the user's own AI provider key
// (BYOK, never stored), and persists the campaign + assets to Postgres.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { callProvider } = require('../../lib/ai-provider');
const { TIERS } = require('../../lib/tiers');
const { getEffectiveUserId } = require('../../lib/workspace');
const { buildPrompt, stripFences, assetsFromParsed, persistCampaign, fireZapierWebhook } = require('../../lib/campaign-engine');
const { generateCampaignImage } = require('../../lib/ai-image');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body.' }) };
  }

  const { provider, apiKey, model, campaign, platforms = [], modules = [], language = 'en', voiceId = null, complianceCheck = false, imageApiKey = null } = body;
  const name = (campaign?.name || '').trim();

  if (!name) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Campaign name is required.' }) };
  if (platforms.length === 0 && modules.filter((m) => m !== 'platform_post').length === 0) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Select at least one platform or module.' }) };
  }

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);

    const userRow = await query('SELECT tier FROM users WHERE id = $1', [effectiveUserId]);
    const tierName = userRow.rows[0]?.tier || 'free';
    const tier = TIERS[tierName] || TIERS.free;

    const disallowedPlatform = platforms.find((p) => !tier.allowedPlatforms.includes(p));
    if (disallowedPlatform) {
      return { statusCode: 403, body: JSON.stringify({ success: false, code: 'TIER_PLATFORM', error: `Your ${tier.label} plan doesn't include ${disallowedPlatform}. Upgrade to unlock it.` }) };
    }
    if (platforms.length > tier.maxPlatforms) {
      return { statusCode: 403, body: JSON.stringify({ success: false, code: 'TIER_PLATFORM_COUNT', error: `Your ${tier.label} plan allows up to ${tier.maxPlatforms} platforms per campaign.` }) };
    }
    const disallowedModule = modules.find((m) => !tier.modules.includes(m));
    if (disallowedModule) {
      return { statusCode: 403, body: JSON.stringify({ success: false, code: 'TIER_MODULE', error: `Your ${tier.label} plan doesn't include the "${disallowedModule}" module. Upgrade to unlock it.` }) };
    }

    if (tier.totalCampaignCap != null) {
      const totalResult = await query('SELECT COUNT(*)::int AS n FROM campaigns WHERE user_id = $1', [effectiveUserId]);
      if (totalResult.rows[0].n >= tier.totalCampaignCap) {
        return { statusCode: 403, body: JSON.stringify({ success: false, code: 'TIER_TOTAL_CAP', error: `Your ${tier.label} plan is limited to ${tier.totalCampaignCap} total campaigns. Upgrade for more.` }) };
      }
    }
    if (tier.dailyCap != null) {
      const dailyResult = await query("SELECT COUNT(*)::int AS n FROM campaigns WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 day'", [effectiveUserId]);
      if (dailyResult.rows[0].n >= tier.dailyCap) {
        return { statusCode: 403, body: JSON.stringify({ success: false, code: 'TIER_DAILY_CAP', error: `Your ${tier.label} plan is limited to ${tier.dailyCap} campaigns per day. Try again tomorrow or upgrade.` }) };
      }
    }

    let voice = null;
    if (voiceId) {
      const voiceResult = await query('SELECT * FROM brand_voices WHERE id = $1 AND user_id = $2', [voiceId, effectiveUserId]);
      voice = voiceResult.rows[0] || null;
    }

    const prompt = buildPrompt({
      inferMode: false,
      name,
      offerUrl: campaign.offerUrl,
      targetAudience: campaign.targetAudience,
      mainBenefit: campaign.mainBenefit,
      tone: campaign.tone,
      platforms,
      modules,
      language,
      voice,
      complianceCheck,
    });

    const aiResult = await callProvider(provider, {
      apiKey,
      model,
      systemPrompt: 'You write real, finished marketing campaign copy and reply with strict JSON only.',
      userPrompt: prompt,
      maxTokens: 3000,
    });

    if (!aiResult.success) {
      return { statusCode: 502, body: JSON.stringify({ success: false, code: aiResult.code, error: aiResult.error }) };
    }

    let parsed;
    try {
      parsed = JSON.parse(stripFences(aiResult.text));
    } catch {
      return { statusCode: 200, body: JSON.stringify({ success: false, code: 'PARSE_FAILED', error: 'The AI response could not be parsed as JSON.', rawText: aiResult.text }) };
    }

    const { assetsToInsert, complianceNotes, imagePrompt } = assetsFromParsed(parsed, complianceCheck);

    if (modules.includes('campaign_image')) {
      if (!imageApiKey) {
        assetsToInsert.push({ module: 'campaign_image', platform: null, label: 'Campaign Image', content: 'Skipped — no OpenAI image key set in Settings.' });
      } else {
        const imgResult = await generateCampaignImage({ apiKey: imageApiKey, prompt: imagePrompt });
        if (imgResult.success) {
          assetsToInsert.push({ module: 'campaign_image', platform: null, label: 'Campaign Image', content: `/.netlify/functions/image?id=${imgResult.imageId}` });
        } else {
          assetsToInsert.push({ module: 'campaign_image', platform: null, label: 'Campaign Image', content: `Image generation failed: ${imgResult.error}` });
        }
      }
    }

    const { campaignId, createdAt } = await persistCampaign({
      userId: effectiveUserId, name, offerUrl: campaign.offerUrl, targetAudience: campaign.targetAudience,
      mainBenefit: campaign.mainBenefit, tone: campaign.tone, platforms, modules, language,
      voiceId: voice?.id, complianceNotes, assetsToInsert,
    });

    fireZapierWebhook(effectiveUserId, { campaign: { id: campaignId, name, platforms, modules, language }, assets: assetsToInsert });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        campaign: { id: campaignId, name, createdAt, platforms, modules, language },
        assets: assetsToInsert,
      }),
    };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet on this deployment.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
