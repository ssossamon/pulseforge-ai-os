// netlify/functions/campaigns-create.js — the core generator.
// Enforces tier limits SERVER-SIDE (closing the earlier client-side-only gap),
// calls the user's own AI provider key (BYOK, never stored), and persists the
// resulting campaign + every generated asset to Postgres.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { callProvider } = require('../../lib/ai-provider');
const { TIERS } = require('../../lib/tiers');
const { getEffectiveUserId } = require('../../lib/workspace');

async function fireZapierWebhook(userId, campaignPayload) {
  try {
    const result = await query('SELECT url FROM zapier_webhooks WHERE user_id = $1', [userId]);
    const url = result.rows[0]?.url;
    if (!url) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campaignPayload),
    }).catch(() => {}); // fire-and-forget: never let a webhook failure affect the user's response
  } catch {
    // never let webhook lookup/delivery failure affect the main response
  }
}

const PLATFORM_SPEC = {
  x: 'X/Twitter post — under 280 characters, punchy, max 2 hashtags',
  facebook: 'Facebook post — conversational, 2-4 sentences, inviting comments',
  linkedin: 'LinkedIn post — 3-5 short paragraphs, professional but human, ends with a soft call to engage',
  threads: 'Threads post — casual, conversational, under 500 characters',
};

const TONE_DESC = {
  direct: 'direct, benefit-first, no fluff',
  playful: 'playful, conversational, light humor',
  authority: 'confident, expert, backed by specifics',
  story: 'storytelling, scene-setting, narrative hook',
};

const LANGUAGE_NAMES = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', tl: 'Tagalog',
};

function buildPrompt({ name, offerUrl, targetAudience, mainBenefit, tone, platforms, modules, language, voice, complianceCheck }) {
  const toneDesc = TONE_DESC[tone] || TONE_DESC.direct;
  const langName = LANGUAGE_NAMES[language] || 'English';
  const shape = {};
  const notes = [];

  if (modules.includes('platform_post') && platforms.length) {
    shape.platform_posts = {};
    platforms.forEach((p) => {
      shape.platform_posts[p] = ['first version', 'a distinctly different second version'];
    });
    notes.push('platform_posts: give TWO distinct posts per platform, matching each platform\'s native format described below:\n' + platforms.map((p) => `- ${p}: ${PLATFORM_SPEC[p]}`).join('\n'));
    shape.platform_posts_pick = {};
    platforms.forEach((p) => { shape.platform_posts_pick[p] = { stronger: '1 or 2', reason: 'one short sentence on why that version is likely to perform better' }; });
    notes.push('platform_posts_pick: for each platform, say which of the two versions (1 or 2) is likely stronger and one short reason why.');
  }
  if (modules.includes('viral_hook')) {
    shape.viral_hooks = ['hook 1', 'hook 2', 'hook 3'];
    notes.push('viral_hooks: 3 scroll-stopping opening lines usable across any platform, each a single sentence.');
  }
  if (modules.includes('cta')) {
    shape.ctas = ['cta 1', 'cta 2', 'cta 3', 'cta 4', 'cta 5'];
    notes.push('ctas: 5 distinct call-to-action variations tailored to the offer and audience, each under 15 words.');
  }
  if (modules.includes('video_hook')) {
    shape.video_hooks = ['hook 1', 'hook 2', 'hook 3'];
    notes.push('video_hooks: 3 short spoken opening lines (first 3 seconds) for YouTube/TikTok/Reels — attention-grabbing, not full scripts.');
  }
  if (modules.includes('email_promo')) {
    shape.email_promo = { subject: 'subject under 60 characters', body: '3-5 short paragraphs' };
    notes.push('email_promo: a subject line written to be opened, and a plain-text promotional email body.');
  }
  if (complianceCheck) {
    shape.compliance_notes = ['note 1', 'note 2'];
    notes.push('compliance_notes: review everything you wrote above for risky claims — unsubstantiated health/financial/income claims, guaranteed-results language, missing required disclaimers. Return an array of short, specific warnings (one per issue found). Return an empty array if nothing looks risky. This is not legal advice, just a first-pass flag.');
  }

  const voiceBlock = voice
    ? `\nBRAND VOICE (apply consistently across everything you write)
Voice description: ${voice.tone_notes || '(none given)'}
Favor these phrases/words where natural: ${voice.signature_phrases || '(none given)'}
Never use these words/phrases: ${voice.banned_words || '(none given)'}\n`
    : '';

  return `You are a marketing copywriter writing real, ready-to-use campaign assets — not descriptions of what they'd look like. Write everything in ${langName}.

CAMPAIGN
Name: ${name}
Offer / URL / product: ${offerUrl || '(not provided — infer reasonably from the name)'}
Target audience: ${targetAudience || '(not specified — infer a sensible general audience)'}
Main benefit to emphasize: ${mainBenefit || '(not specified — infer the most compelling benefit from the offer)'}
Tone: ${toneDesc}
${voiceBlock}
Write the following modules:
${notes.join('\n\n')}

Return ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${JSON.stringify(shape, null, 2)}

Every value must be the finished, ready-to-use copy itself, written in ${langName}. Do not invent statistics, testimonials, or claims not reasonably implied by the input.`;
}

function stripFences(text) {
  return text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
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

  const { provider, apiKey, model, campaign, platforms = [], modules = [], language = 'en', voiceId = null, complianceCheck = false } = body;
  const name = (campaign?.name || '').trim();

  if (!name) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Campaign name is required.' }) };
  if (platforms.length === 0 && modules.filter((m) => m !== 'platform_post').length === 0) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Select at least one platform or module.' }) };
  }

  try {
    // Team members share their owner's campaign workspace and quota.
    const effectiveUserId = await getEffectiveUserId(payload.sub);

    // Fresh tier check — never trust the token's cached tier for enforcement.
    // Tier/quota is based on the workspace owner, since that's whose plan pays for it.
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
      const voiceResult = await query('SELECT * FROM brand_voices WHERE id = $1 AND user_id = $2', [voiceId, payload.sub]);
      voice = voiceResult.rows[0] || null;
    }

    const prompt = buildPrompt({
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

    // Persist campaign + assets. Stored under the effective workspace owner
    // so team members and the owner see the same shared campaign history.
    const complianceNotes = Array.isArray(parsed.compliance_notes) ? parsed.compliance_notes : [];
    const campResult = await query(
      `INSERT INTO campaigns (user_id, name, offer_url, target_audience, main_benefit, tone, platforms, asset_modules, language, voice_id, compliance_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
      [effectiveUserId, name, campaign.offerUrl || null, campaign.targetAudience || null, campaign.mainBenefit || null, campaign.tone || 'direct', platforms, modules, language, voice?.id || null, complianceNotes]
    );
    const campaignId = campResult.rows[0].id;
    const assetsToInsert = [];

    if (parsed.platform_posts) {
      const picks = parsed.platform_posts_pick || {};
      Object.entries(parsed.platform_posts).forEach(([platform, posts]) => {
        const pick = picks[platform];
        (Array.isArray(posts) ? posts : [posts]).forEach((content, idx) => {
          const versionNum = idx + 1;
          const isPicked = pick && String(pick.stronger) === String(versionNum);
          const label = `${platform.toUpperCase()} Post #${versionNum}${isPicked ? ' ⭐ Stronger pick' : ''}`;
          const finalContent = isPicked && pick.reason ? `${content}\n\n[AI note: ${pick.reason}]` : content;
          assetsToInsert.push({ module: 'platform_post', platform, label, content: finalContent });
        });
      });
    }
    if (Array.isArray(parsed.viral_hooks)) {
      parsed.viral_hooks.forEach((content, idx) => assetsToInsert.push({ module: 'viral_hook', platform: null, label: `Viral Hook #${idx + 1}`, content }));
    }
    if (Array.isArray(parsed.ctas)) {
      parsed.ctas.forEach((content, idx) => assetsToInsert.push({ module: 'cta', platform: null, label: `CTA #${idx + 1}`, content }));
    }
    if (Array.isArray(parsed.video_hooks)) {
      parsed.video_hooks.forEach((content, idx) => assetsToInsert.push({ module: 'video_hook', platform: null, label: `Video Hook #${idx + 1}`, content }));
    }
    if (parsed.email_promo) {
      assetsToInsert.push({ module: 'email_promo', platform: null, label: 'Email Promo', content: `Subject: ${parsed.email_promo.subject}\n\n${parsed.email_promo.body}` });
    }
    if (complianceCheck) {
      const notesText = complianceNotes.length
        ? complianceNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')
        : 'No risky claims flagged. This is an AI first pass, not legal advice — have a human review before publishing regulated-niche content.';
      assetsToInsert.push({ module: 'compliance_check', platform: null, label: 'Compliance Check', content: notesText });
    }

    for (const a of assetsToInsert) {
      await query('INSERT INTO assets (campaign_id, module, platform, label, content) VALUES ($1,$2,$3,$4,$5)', [campaignId, a.module, a.platform, a.label, a.content]);
    }

    // Fire-and-forget: push to Zapier if the workspace owner has a webhook configured.
    fireZapierWebhook(effectiveUserId, { campaign: { id: campaignId, name, platforms, modules, language }, assets: assetsToInsert });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        campaign: { id: campaignId, name, createdAt: campResult.rows[0].created_at, platforms, modules, language },
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
