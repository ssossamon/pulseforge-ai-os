// netlify/functions/team-invite.js — owner generates an invite code/link.
const crypto = require('crypto');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    // A user who is themselves a team member can't also own a team —
    // keeps the sharing model to one level deep, no nested teams.
    const selfRow = await query('SELECT team_owner_id FROM users WHERE id = $1', [payload.sub]);
    if (selfRow.rows[0]?.team_owner_id) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: "You're already a member of another team — members can't also invite their own." }) };
    }

    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim().toLowerCase() || null;

    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    await query('INSERT INTO team_invites (owner_user_id, code, email) VALUES ($1, $2, $3)', [payload.sub, code, email]);

    return { statusCode: 200, body: JSON.stringify({ success: true, code }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
