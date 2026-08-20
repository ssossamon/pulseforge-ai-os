// netlify/functions/team-join.js — a signed-in user redeems an invite code.
const { getPool } = require('../../lib/db');
const { requireAuth, signToken } = require('../../lib/auth');

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
  const code = (body.code || '').trim().toUpperCase();
  if (!code) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Enter an invite code.' }) };

  let client;
  try {
    const pool = getPool();
    client = await pool.connect();
    await client.query('BEGIN');

    const inviteResult = await client.query('SELECT * FROM team_invites WHERE code = $1 FOR UPDATE', [code]);
    const invite = inviteResult.rows[0];
    if (!invite) {
      await client.query('ROLLBACK');
      return { statusCode: 404, body: JSON.stringify({ success: false, error: "That invite code doesn't exist." }) };
    }
    if (invite.status !== 'pending') {
      await client.query('ROLLBACK');
      return { statusCode: 409, body: JSON.stringify({ success: false, error: `This invite was already ${invite.status}.` }) };
    }
    if (invite.owner_user_id === payload.sub) {
      await client.query('ROLLBACK');
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "You can't join your own team." }) };
    }

    const selfRow = await client.query('SELECT email, team_owner_id FROM users WHERE id = $1', [payload.sub]);
    const self = selfRow.rows[0];
    if (invite.email && invite.email !== self.email) {
      await client.query('ROLLBACK');
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'This invite is restricted to a different email address.' }) };
    }
    if (self.team_owner_id) {
      await client.query('ROLLBACK');
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "You're already on a team. Leave it before joining another." }) };
    }

    await client.query('UPDATE team_invites SET status = $1, redeemed_at = NOW(), redeemed_by_user_id = $2 WHERE id = $3', ['redeemed', payload.sub, invite.id]);
    const userResult = await client.query(
      'UPDATE users SET team_owner_id = $1 WHERE id = $2 RETURNING id, email, name, tier, is_admin, team_owner_id',
      [invite.owner_user_id, payload.sub]
    );
    await client.query('COMMIT');

    const user = userResult.rows[0];
    const token = signToken(user);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, token, user: { id: user.id, email: user.email, name: user.name, tier: user.tier, isAdmin: user.is_admin, teamOwnerId: user.team_owner_id } }),
    };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  } finally {
    if (client) client.release();
  }
};
