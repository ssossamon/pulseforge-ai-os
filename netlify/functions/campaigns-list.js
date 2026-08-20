// netlify/functions/campaigns-list.js
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    const search = event.queryStringParameters?.q?.trim();
    let result;
    if (search) {
      result = await query(
        `SELECT id, name, offer_url, platforms, asset_modules, created_at FROM campaigns
         WHERE user_id = $1 AND name ILIKE $2 ORDER BY created_at DESC LIMIT 200`,
        [payload.sub, `%${search}%`]
      );
    } else {
      result = await query(
        `SELECT id, name, offer_url, platforms, asset_modules, created_at FROM campaigns
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [payload.sub]
      );
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, campaigns: result.rows }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
