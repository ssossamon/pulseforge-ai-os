// netlify/functions/auth-login.js
const { query } = require('../../lib/db');
const { verifyPassword, signToken } = require('../../lib/auth');

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

  if (!email || !password) {
    return { statusCode: 400, body: JSON.stringify({ success: false, code: 'MISSING', error: 'Enter your email and password.' }) };
  }

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ success: false, code: 'INVALID', error: 'No account matches that email and password.' }) };
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return { statusCode: 401, body: JSON.stringify({ success: false, code: 'INVALID', error: 'No account matches that email and password.' }) };
    }
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
      return { statusCode: 501, body: JSON.stringify({ success: false, code: 'NOT_CONFIGURED', error: 'Accounts are not fully configured yet on this deployment. Contact the site owner.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, code: 'SERVER_ERROR', error: `Could not sign in: ${err.message}` }) };
  }
};
