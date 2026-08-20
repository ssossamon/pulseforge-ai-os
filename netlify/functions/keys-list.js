// netlify/functions/keys-list.js — admin-only.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    const admin = await query('SELECT is_admin FROM users WHERE id = $1', [payload.sub]);
    if (!admin.rows[0]?.is_admin) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin access required.' }) };
    }
    const result = await query(
      `SELECT k.id, k.key_value, k.tier, k.status, k.created_at, k.redeemed_at, u.email AS redeemed_by_email
       FROM license_keys k LEFT JOIN users u ON u.id = k.redeemed_by_user_id
       ORDER BY k.created_at DESC LIMIT 500`
    );
    return { statusCode: 200, body: JSON.stringify({ success: true, keys: result.rows }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
