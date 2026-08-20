// netlify/functions/admin-users.js — admin-only user directory + tier/role editing.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

async function assertAdmin(payload) {
  const result = await query('SELECT is_admin FROM users WHERE id = $1', [payload.sub]);
  return !!result.rows[0]?.is_admin;
}

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    if (!(await assertAdmin(payload))) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin access required.' }) };
    }

    if (event.httpMethod === 'GET') {
      const result = await query(`
        SELECT u.id, u.email, u.name, u.tier, u.is_admin, u.created_at,
               COUNT(c.id) AS campaign_count
        FROM users u
        LEFT JOIN campaigns c ON c.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 500
      `);
      return { statusCode: 200, body: JSON.stringify({ success: true, users: result.rows }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { userId, tier, isAdmin } = body;
      if (!userId) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'userId is required.' }) };

      const updates = [];
      const params = [];
      let i = 1;
      if (tier) { updates.push(`tier = $${i++}`); params.push(tier); }
      if (typeof isAdmin === 'boolean') { updates.push(`is_admin = $${i++}`); params.push(isAdmin); }
      if (updates.length === 0) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Nothing to update.' }) };

      params.push(userId);
      const result = await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, name, tier, is_admin`,
        params
      );
      if (result.rows.length === 0) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'User not found.' }) };
      return { statusCode: 200, body: JSON.stringify({ success: true, user: result.rows[0] }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use GET or POST.' }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
