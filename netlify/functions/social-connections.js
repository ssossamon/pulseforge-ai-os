// netlify/functions/social-connections.js — GET (list), DELETE (?platform=)
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    if (event.httpMethod === 'GET') {
      const result = await query('SELECT platform, account_label, created_at FROM social_connections WHERE user_id = $1', [payload.sub]);
      return { statusCode: 200, body: JSON.stringify({ success: true, connections: result.rows }) };
    }

    if (event.httpMethod === 'DELETE') {
      const platform = event.queryStringParameters?.platform;
      if (!platform) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'platform is required.' }) };
      await query('DELETE FROM social_connections WHERE user_id = $1 AND platform = $2', [payload.sub, platform]);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use GET or DELETE.' }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
