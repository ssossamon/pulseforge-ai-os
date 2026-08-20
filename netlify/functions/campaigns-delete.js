// netlify/functions/campaigns-delete.js
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { getEffectiveUserId } = require('../../lib/workspace');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST or DELETE.' }) };
  }
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  let id = event.queryStringParameters?.id;
  if (!id) {
    try { id = JSON.parse(event.body || '{}').id; } catch { /* noop */ }
  }
  if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);
    const result = await query('DELETE FROM campaigns WHERE id = $1 AND user_id = $2 RETURNING id', [id, effectiveUserId]);
    if (result.rows.length === 0) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Campaign not found.' }) };
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
