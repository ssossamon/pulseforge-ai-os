// netlify/functions/zapier-webhook.js — GET (current), POST (set/update), DELETE (remove)
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    if (event.httpMethod === 'GET') {
      const result = await query('SELECT url, created_at FROM zapier_webhooks WHERE user_id = $1', [payload.sub]);
      return { statusCode: 200, body: JSON.stringify({ success: true, webhook: result.rows[0] || null }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const url = (body.url || '').trim();
      if (!/^https:\/\//.test(url)) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Webhook URL must start with https://.' }) };
      }
      const result = await query(
        `INSERT INTO zapier_webhooks (user_id, url) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET url = EXCLUDED.url
         RETURNING url, created_at`,
        [payload.sub, url]
      );
      return { statusCode: 200, body: JSON.stringify({ success: true, webhook: result.rows[0] }) };
    }

    if (event.httpMethod === 'DELETE') {
      await query('DELETE FROM zapier_webhooks WHERE user_id = $1', [payload.sub]);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use GET, POST, or DELETE.' }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
