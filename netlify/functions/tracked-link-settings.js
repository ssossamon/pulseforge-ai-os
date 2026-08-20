// netlify/functions/tracked-link-settings.js — POST (?id=) update mode,
// auto_declare, min_conversions_to_declare, or manually clear a declared winner.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { getEffectiveUserId } = require('../../lib/workspace');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);
    const body = JSON.parse(event.body || '{}');

    const updates = [];
    const params = [];
    let i = 1;
    if (body.mode) { updates.push(`mode = $${i++}`); params.push(body.mode); }
    if (typeof body.autoDeclare === 'boolean') { updates.push(`auto_declare = $${i++}`); params.push(body.autoDeclare); }
    if (body.minConversionsToDeclare) { updates.push(`min_conversions_to_declare = $${i++}`); params.push(body.minConversionsToDeclare); }
    if (body.clearWinner === true) { updates.push(`winner_destination_id = NULL`); }
    if (updates.length === 0) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Nothing to update.' }) };

    params.push(id, effectiveUserId);
    const result = await query(
      `UPDATE tracked_links SET ${updates.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Not found.' }) };
    return { statusCode: 200, body: JSON.stringify({ success: true, link: result.rows[0] }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
