// netlify/functions/social-post.js — publishes real content to a connected
// social account using that user's own stored OAuth token. Real API calls
// only; if the connection is missing/expired, returns a clear error rather
// than pretending it posted.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { postToPlatform } = require('../../lib/social-post-helpers');

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
  const { platform, content } = body;
  if (!['x', 'linkedin', 'facebook', 'threads'].includes(platform)) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Unsupported platform.' }) };
  }
  if (!content || !content.trim()) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'No content to post.' }) };
  }

  try {
    const connResult = await query('SELECT * FROM social_connections WHERE user_id = $1 AND platform = $2', [payload.sub, platform]);
    const connection = connResult.rows[0];
    if (!connection) {
      const labels = { x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook', threads: 'Threads' };
      return { statusCode: 404, body: JSON.stringify({ success: false, code: 'NOT_CONNECTED', error: `You haven't connected a ${labels[platform]} account yet. Connect it in Settings.` }) };
    }

    const result = await postToPlatform(platform, connection, content);
    return { statusCode: result.success ? 200 : 502, body: JSON.stringify(result) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
