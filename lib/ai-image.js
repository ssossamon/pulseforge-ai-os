// lib/ai-image.js — real image generation via OpenAI's image API (DALL-E 3),
// persisted to Netlify Blobs so it survives beyond OpenAI's short-lived URLs.
// Image generation is OpenAI-only regardless of which text provider the user
// picked — Anthropic has no image API, and Gemini's is not broadly available
// yet — so this always takes its own OpenAI key (BYOK, same as text keys).
const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

async function generateCampaignImage({ apiKey, prompt }) {
  if (!apiKey || apiKey.trim().length < 8) {
    return { success: false, code: 'NO_KEY', error: 'No OpenAI image key provided.' };
  }
  if (!prompt || !prompt.trim()) {
    return { success: false, code: 'NO_PROMPT', error: 'No image prompt to generate from.' };
  }

  let res;
  try {
    res = await Promise.race([
      fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: prompt.slice(0, 4000),
          n: 1,
          size: '1024x1024',
          quality: 'standard',
          response_format: 'b64_json',
        }),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 60000)),
    ]);
  } catch (err) {
    if (err.message === 'TIMEOUT') return { success: false, code: 'TIMEOUT', error: 'Image generation timed out after 60 seconds.' };
    return { success: false, code: 'NETWORK', error: `Could not reach OpenAI: ${err.message}` };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) return { success: false, code: 'AUTH', error: 'OpenAI rejected this image key.' };
    if (res.status === 429) return { success: false, code: 'RATE_LIMIT', error: 'OpenAI rate-limited the image request. Check billing/usage or try again shortly.' };
    if (res.status === 400 && /content_policy/i.test(data?.error?.code || '')) {
      return { success: false, code: 'CONTENT_POLICY', error: 'OpenAI declined this image prompt for policy reasons.' };
    }
    return { success: false, code: 'UNKNOWN', error: `OpenAI image error (HTTP ${res.status}): ${data?.error?.message || 'no details'}` };
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) return { success: false, code: 'EMPTY', error: 'OpenAI returned no image data.' };

  const imageId = crypto.randomUUID();
  const buffer = Buffer.from(b64, 'base64');
  const store = getStore('campaign-images');
  await store.set(imageId, buffer, { metadata: { contentType: 'image/png' } });

  return { success: true, imageId };
}

module.exports = { generateCampaignImage };
