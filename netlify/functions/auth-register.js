// netlify/functions/auth-register.js
const { query } = require('../../lib/db');
const { hashPassword, signToken } = require('../../lib/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body.' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || '').trim();

  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ success: false, code: 'BAD_EMAIL', error: 'Enter a valid email address.' }) };
  }
  if (password.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ success: false, code: 'WEAK_PASSWORD', error: 'Password must be at least 8 characters.' }) };
  }

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return { statusCode: 409, body: JSON.stringify({ success: false, code: 'EXISTS', error: 'An account with that email already exists. Try signing in instead.' }) };
    }

    const ownerEmail = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
    const isOwner = ownerEmail && email === ownerEmail;
    const tier = isOwner ? 'enterprise' : 'free';
    const isAdmin = !!isOwner;

    const password_hash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, tier, is_admin)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, tier, is_admin, created_at`,
      [email, password_hash, name || null, tier, isAdmin]
    );
    const user = result.rows[0];
    const token = signToken(user);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        token,
        user: { id: user.id, email: user.email, name: user.name, tier: user.tier, isAdmin: user.is_admin },
      }),
    };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED' || err.message === 'NO_JWT_SECRET') {
      return { statusCode: 501, body: JSON.stringify({ success: false, code: 'NOT_CONFIGURED', error: 'Accounts are not fully configured yet on this deployment (missing database or JWT secret). Contact the site owner.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, code: 'SERVER_ERROR', error: `Could not create account: ${err.message}` }) };
  }
};
