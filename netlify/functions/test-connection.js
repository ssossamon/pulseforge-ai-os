// netlify/functions/test-connection.js — used by Settings' "Test connection"
// button. Fires one real, minimal request at the chosen provider.
const { callProvider } = require('../../lib/ai-provider');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body.' }) };
  }
  const result = await callProvider(body.provider, {
    apiKey: body.apiKey,
    model: body.model,
    systemPrompt: 'Reply with exactly one word: OK',
    userPrompt: 'Reply with exactly one word: OK',
    maxTokens: 10,
  });
  return { statusCode: result.success ? 200 : 502, body: JSON.stringify(result) };
};
