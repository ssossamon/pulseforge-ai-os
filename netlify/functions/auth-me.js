// netlify/functions/auth-me.js — validates the bearer token and returns the
// CURRENT database row (not just what's in the token), so a tier/admin change
// made by an admin takes effect on next load without forcing re-login.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) {
    return { statusCode: 401, body: JSON.stringify({ success: false, code: 'NO_SESSION', error: 'Not signed in.' }) };
  }
  try {
    const result = await query('SELECT id, email, name, tier, is_admin, team_owner_id, created_at FROM users WHERE id = $1', [payload.sub]);
    const user = result.rows[0];
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ success: false, code: 'NOT_FOUND', error: 'Account no longer exists.' }) };
    }
    let teamOwnerEmail = null;
    if (user.team_owner_id) {
      const ownerResult = await query('SELECT email FROM users WHERE id = $1', [user.team_owner_id]);
      teamOwnerEmail = ownerResult.rows[0]?.email || null;
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, user: { id: user.id, email: user.email, name: user.name, tier: user.tier, isAdmin: user.is_admin, teamOwnerId: user.team_owner_id, teamOwnerEmail } }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
