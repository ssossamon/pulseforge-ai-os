// lib/ai-provider.js — real, live calls to the user's chosen AI provider.
// No mock responses anywhere: every success here is a real provider response,
// every failure is a real provider error translated to plain English.

const TIMEOUT_MS = 60000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms)),
  ]);
}

function plainError(code, message) {
  return { success: false, code, error: message };
}

async function callOpenAI({ apiKey, model, systemPrompt, userPrompt, maxTokens }) {
  const res = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: maxTokens || 2200,
        temperature: 0.8,
      }),
    }),
    TIMEOUT_MS
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) return plainError('AUTH', 'OpenAI rejected this API key.');
    if (res.status === 429) return plainError('RATE_LIMIT', 'OpenAI rate-limited this request. Check usage/billing or try again shortly.');
    if (res.status === 404) return plainError('MODEL', `OpenAI could not find model "${model}".`);
    if (res.status >= 500) return plainError('PROVIDER_DOWN', 'OpenAI is having server issues. Try again shortly.');
    return plainError('UNKNOWN', `OpenAI error (HTTP ${res.status}): ${data?.error?.message || 'no details'}`);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return plainError('EMPTY', 'OpenAI returned no usable content (possibly filtered).');
  return { success: true, text };
}

async function callAnthropic({ apiKey, model, systemPrompt, userPrompt, maxTokens }) {
  const res = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: maxTokens || 2200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }),
    TIMEOUT_MS
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) return plainError('AUTH', 'Anthropic rejected this API key.');
    if (res.status === 429) return plainError('RATE_LIMIT', 'Anthropic rate-limited this request. Check usage/billing or try again shortly.');
    if (res.status === 404) return plainError('MODEL', `Anthropic could not find model "${model}".`);
    if (res.status >= 500) return plainError('PROVIDER_DOWN', 'Anthropic is having server issues. Try again shortly.');
    return plainError('UNKNOWN', `Anthropic error (HTTP ${res.status}): ${data?.error?.message || 'no details'}`);
  }
  const text = data?.content?.map((b) => b.text || '').join('') || '';
  if (!text) return plainError('EMPTY', 'Anthropic returned no usable content.');
  return { success: true, text };
}

async function callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens }) {
  const mdl = model || 'gemini-2.0-flash';
  const res = await withTimeout(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens || 2200, temperature: 0.8 },
      }),
    }),
    TIMEOUT_MS
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 400 && /API key/i.test(data?.error?.message || '')) return plainError('AUTH', 'Google rejected this API key.');
    if (res.status === 429) return plainError('RATE_LIMIT', 'Gemini rate-limited this request. Check usage/billing or try again shortly.');
    if (res.status === 404) return plainError('MODEL', `Gemini could not find model "${mdl}".`);
    if (res.status >= 500) return plainError('PROVIDER_DOWN', 'Gemini is having server issues. Try again shortly.');
    return plainError('UNKNOWN', `Gemini error (HTTP ${res.status}): ${data?.error?.message || 'no details'}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) return plainError('EMPTY', 'Gemini returned no usable content (possibly safety-filtered).');
  return { success: true, text };
}

async function callProvider(provider, args) {
  if (!args.apiKey || args.apiKey.trim().length < 8) return plainError('NO_KEY', 'No API key provided.');
  try {
    if (provider === 'openai') return await callOpenAI(args);
    if (provider === 'anthropic') return await callAnthropic(args);
    if (provider === 'gemini') return await callGemini(args);
    return plainError('BAD_PROVIDER', `Unknown provider "${provider}".`);
  } catch (err) {
    if (err.message === 'TIMEOUT') return plainError('TIMEOUT', 'The AI provider did not respond within 60 seconds.');
    return plainError('NETWORK', `Could not reach the AI provider: ${err.message}`);
  }
}

module.exports = { callProvider };
