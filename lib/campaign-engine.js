// lib/campaign-engine.js — shared core used by campaigns-create.js (manual
// brief) and campaigns-auto.js (one-click: AI infers the brief itself).
const { query } = require('./db');

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

// When inferMode is true, name/targetAudience/mainBenefit/tone/platforms/
// modules may be omitted — the AI is asked to infer a full campaign brief
// itself from rawInput (a pasted URL, product name, or rough idea, plus
// optional fetched page text) before writing any assets.
function buildPrompt({ inferMode, rawInput, pageText, name, offerUrl, targetAudience, mainBenefit, tone, platforms, modules, language, voice, complianceCheck }) {
  const toneDesc = inferMode ? null : (TONE_DESC[tone] || TONE_DESC.direct);
  const langName = LANGUAGE_NAMES[language] || 'English';
  const shape = {};
  const notes = [];

  if (inferMode) {
    shape.campaign_brief = {
      name: 'a short, memorable campaign name (a few words)',
      target_audience: 'who this is for, one sentence',
      main_benefit: 'the single most compelling benefit to lead with, one sentence',
      tone: 'one of: direct, playful, authority, story — whichever fits the input best',
    };
    notes.push('campaign_brief: infer this entirely from the input below (and the fetched page text if provided). Do not ask for more information — make a reasonable, specific judgment call.');
  }

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

  const campaignBlock = inferMode
    ? `RAW INPUT (a URL, product name, or rough idea — infer everything else from this)
"""${rawInput}"""
${pageText ? `\nFETCHED PAGE TEXT (best-effort extract from the URL above, may be partial or missing sections):\n"""${pageText}"""\n` : ''}`
    : `CAMPAIGN
Name: ${name}
Offer / URL / product: ${offerUrl || '(not provided — infer reasonably from the name)'}
Target audience: ${targetAudience || '(not specified — infer a sensible general audience)'}
Main benefit to emphasize: ${mainBenefit || '(not specified — infer the most compelling benefit from the offer)'}
Tone: ${toneDesc}`;

  return `You are a marketing copywriter writing real, ready-to-use campaign assets — not descriptions of what they'd look like. Write everything in ${langName}.

${campaignBlock}
${voiceBlock}
Write the following${inferMode ? ', using the campaign_brief you infer for name/audience/benefit/tone' : ''}:
${notes.join('\n\n')}

Return ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${JSON.stringify(shape, null, 2)}

Every value must be the finished, ready-to-use copy itself, written in ${langName}. Do not invent statistics, testimonials, or claims not reasonably implied by the input.`;
}

function stripFences(text) {
  return text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
}

function assetsFromParsed(parsed, complianceCheck) {
  const assetsToInsert = [];
  const complianceNotes = Array.isArray(parsed.compliance_notes) ? parsed.compliance_notes : [];

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
  return { assetsToInsert, complianceNotes };
}

async function persistCampaign({ userId, name, offerUrl, targetAudience, mainBenefit, tone, platforms, modules, language, voiceId, complianceNotes, assetsToInsert }) {
  const campResult = await query(
    `INSERT INTO campaigns (user_id, name, offer_url, target_audience, main_benefit, tone, platforms, asset_modules, language, voice_id, compliance_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
    [userId, name, offerUrl || null, targetAudience || null, mainBenefit || null, tone || 'direct', platforms, modules, language, voiceId || null, complianceNotes]
  );
  const campaignId = campResult.rows[0].id;
  for (const a of assetsToInsert) {
    await query('INSERT INTO assets (campaign_id, module, platform, label, content) VALUES ($1,$2,$3,$4,$5)', [campaignId, a.module, a.platform, a.label, a.content]);
  }
  return { campaignId, createdAt: campResult.rows[0].created_at };
}

async function fireZapierWebhook(userId, campaignPayload) {
  try {
    const result = await query('SELECT url FROM zapier_webhooks WHERE user_id = $1', [userId]);
    const url = result.rows[0]?.url;
    if (!url) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campaignPayload),
    }).catch(() => {});
  } catch {
    // never let webhook lookup/delivery failure affect the main response
  }
}

module.exports = { buildPrompt, stripFences, assetsFromParsed, persistCampaign, fireZapierWebhook, PLATFORM_SPEC, TONE_DESC, LANGUAGE_NAMES };
