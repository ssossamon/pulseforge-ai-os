// netlify/functions/tracked-link-stats.js — GET ?id= — authed, owner only.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { getEffectiveUserId } = require('../../lib/workspace');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);
    const linkResult = await query('SELECT * FROM tracked_links WHERE id = $1 AND user_id = $2', [id, effectiveUserId]);
    const link = linkResult.rows[0];
    if (!link) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Not found.' }) };

    const destResult = await query('SELECT * FROM tracked_link_destinations WHERE tracked_link_id = $1 ORDER BY sort_order', [id]);
    const clicksResult = await query('SELECT ip_address, referer, clicked_at, destination_id FROM tracked_link_clicks WHERE tracked_link_id = $1 ORDER BY clicked_at DESC LIMIT 50', [id]);

    return { statusCode: 200, body: JSON.stringify({ success: true, link, destinations: destResult.rows, recentClicks: clicksResult.rows }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
