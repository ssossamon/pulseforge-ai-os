// netlify/functions/team-members.js — GET (list members + pending invites), DELETE (?userId= to remove a member)
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    if (event.httpMethod === 'GET') {
      const members = await query('SELECT id, email, name, created_at FROM users WHERE team_owner_id = $1 ORDER BY created_at', [payload.sub]);
      const pendingInvites = await query("SELECT code, email, created_at FROM team_invites WHERE owner_user_id = $1 AND status = 'pending' ORDER BY created_at DESC", [payload.sub]);
      return { statusCode: 200, body: JSON.stringify({ success: true, members: members.rows, pendingInvites: pendingInvites.rows }) };
    }

    if (event.httpMethod === 'DELETE') {
      const userId = event.queryStringParameters?.userId;
      if (!userId) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'userId is required.' }) };
      const result = await query('UPDATE users SET team_owner_id = NULL WHERE id = $1 AND team_owner_id = $2 RETURNING id', [userId, payload.sub]);
      if (result.rows.length === 0) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Not a member of your team.' }) };
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
