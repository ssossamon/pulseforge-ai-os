// netlify/functions/campaigns-auto.js — one-click generation.
// Takes just a URL, product name, or rough idea. If it looks like a URL,
// makes a best-effort fetch of the page and extracts rough text as extra
// context. The AI is then asked to infer the full campaign brief (name,
// audience, benefit, tone) itself before writing every requested module —
// all in a single provider call, one click, no form-filling.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { callProvider } = require('../../lib/ai-provider');
const { TIERS } = require('../../lib/tiers');
const { getEffectiveUserId } = require('../../lib/workspace');
const { buildPrompt, stripFences, assetsFromParsed, persistCampaign, fireZapierWebhook } = require('../../lib/campaign-engine');

const URL_RE = /^https?:\/\/\S+$/i;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PulseForgeBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = await res.text();
    return stripHtml(html).slice(0, 4000);
  } catch {
    return null; // best-effort only — generation proceeds without it
  }
}

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

  const { provider, apiKey, model, input, language = 'en', voiceId = null, complianceCheck = true } = body;
  const rawInput = (input || '').trim();
  if (!rawInput) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Paste a URL, product name, or idea first.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);

    const userRow = await query('SELECT tier FROM users WHERE id = $1', [effectiveUserId]);
    const tierName = userRow.rows[0]?.tier || 'free';
    const tier = TIERS[tierName] || TIERS.free;

    // One-click mode always requests everything the tier allows.
    const platforms = tier.allowedPlatforms.slice(0, tier.maxPlatforms);
    const modules = tier.modules;

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

    let pageText = null;
    if (URL_RE.test(rawInput)) {
      pageText = await fetchPageText(rawInput);
    }

    const prompt = buildPrompt({
      inferMode: true,
      rawInput,
      pageText,
      platforms,
      modules,
      language,
      voice,
      complianceCheck,
    });

    const aiResult = await callProvider(provider, {
      apiKey,
      model,
      systemPrompt: 'You are an autonomous marketing campaign agent. Infer the full campaign brief from the input, then write real, finished campaign copy. Reply with strict JSON only.',
      userPrompt: prompt,
      maxTokens: 3200,
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

    const brief = parsed.campaign_brief || {};
    const name = (brief.name || rawInput.slice(0, 60) || 'Untitled Campaign').trim();
    const targetAudience = brief.target_audience || null;
    const mainBenefit = brief.main_benefit || null;
    const tone = ['direct', 'playful', 'authority', 'story'].includes(brief.tone) ? brief.tone : 'direct';
    const offerUrl = URL_RE.test(rawInput) ? rawInput : null;

    const { assetsToInsert, complianceNotes } = assetsFromParsed(parsed, complianceCheck);
    const { campaignId, createdAt } = await persistCampaign({
      userId: effectiveUserId, name, offerUrl, targetAudience, mainBenefit, tone, platforms, modules, language,
      voiceId: voice?.id, complianceNotes, assetsToInsert,
    });

    fireZapierWebhook(effectiveUserId, { campaign: { id: campaignId, name, platforms, modules, language }, assets: assetsToInsert });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        campaign: { id: campaignId, name, createdAt, platforms, modules, language, targetAudience, mainBenefit, tone },
        assets: assetsToInsert,
        pageFetched: !!pageText,
      }),
    };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet on this deployment.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
