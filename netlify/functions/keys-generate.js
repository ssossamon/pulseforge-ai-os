// netlify/functions/keys-generate.js — admin-only keygen.
const crypto = require('crypto');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

const VALID_TIERS = ['starter', 'enterprise'];

function makeKey(tier) {
  const block = () => crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
  return `PFAI-${tier.toUpperCase()}-${block()}-${block()}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    const admin = await query('SELECT is_admin FROM users WHERE id = $1', [payload.sub]);
    if (!admin.rows[0]?.is_admin) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin access required.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const tier = body.tier;
    const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 100);

    if (!VALID_TIERS.includes(tier)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: `Tier must be one of: ${VALID_TIERS.join(', ')}` }) };
    }

    const generated = [];
    for (let i = 0; i < count; i++) {
      let key, inserted = false, attempts = 0;
      while (!inserted && attempts < 5) {
        key = makeKey(tier);
        try {
          await query(
            'INSERT INTO license_keys (key_value, tier, created_by_admin_id) VALUES ($1, $2, $3)',
            [key, tier, payload.sub]
          );
          inserted = true;
        } catch (err) {
          if (err.code === '23505') { attempts++; continue; } // unique collision, retry
          throw err;
        }
      }
      if (inserted) generated.push(key);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, keys: generated }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
