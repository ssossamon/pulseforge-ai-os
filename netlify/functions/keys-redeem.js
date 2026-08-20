// netlify/functions/keys-redeem.js — real server-side license verification.
// Replaces the old client-side-only format check: a key is only valid if it
// exists in license_keys with status='unused'. Redeeming updates both the
// key (status, redeemed_by, redeemed_at) and the user's tier, atomically.
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
  const key = (body.key || '').trim().toUpperCase();
  if (!key) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Enter a license key.' }) };

  let client;
  try {
    const pool = getPool();
    client = await pool.connect();
    await client.query('BEGIN');

    const found = await client.query('SELECT * FROM license_keys WHERE key_value = $1 FOR UPDATE', [key]);
    const row = found.rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      return { statusCode: 404, body: JSON.stringify({ success: false, code: 'NOT_FOUND', error: "That key doesn't exist. Double-check it and try again." }) };
    }
    if (row.status !== 'unused') {
      await client.query('ROLLBACK');
      return { statusCode: 409, body: JSON.stringify({ success: false, code: 'ALREADY_USED', error: `This key was already ${row.status === 'redeemed' ? 'redeemed' : row.status}.` }) };
    }

    await client.query(
      'UPDATE license_keys SET status = $1, redeemed_by_user_id = $2, redeemed_at = NOW() WHERE id = $3',
      ['redeemed', payload.sub, row.id]
    );
    const userResult = await client.query(
      'UPDATE users SET tier = $1 WHERE id = $2 RETURNING id, email, name, tier, is_admin',
      [row.tier, payload.sub]
    );
    await client.query('COMMIT');

    const user = userResult.rows[0];
    const token = signToken(user);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, token, user: { id: user.id, email: user.email, name: user.name, tier: user.tier, isAdmin: user.is_admin } }),
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
