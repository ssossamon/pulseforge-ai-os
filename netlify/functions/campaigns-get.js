// netlify/functions/campaigns-get.js
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };

  try {
    const campResult = await query('SELECT * FROM campaigns WHERE id = $1 AND user_id = $2', [id, payload.sub]);
    const campaign = campResult.rows[0];
    if (!campaign) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Campaign not found.' }) };

    const assetsResult = await query('SELECT module, platform, label, content FROM assets WHERE campaign_id = $1 ORDER BY id', [id]);
    return { statusCode: 200, body: JSON.stringify({ success: true, campaign, assets: assetsResult.rows }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
