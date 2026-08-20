// netlify/functions/tracked-link-destinations.js — POST (add one or many
// destinations — bulk array powers CSV import), DELETE (?id=)
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { getEffectiveUserId } = require('../../lib/workspace');

async function assertOwnership(trackedLinkId, effectiveUserId) {
  const result = await query('SELECT id FROM tracked_links WHERE id = $1 AND user_id = $2', [trackedLinkId, effectiveUserId]);
  return result.rows.length > 0;
}

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const trackedLinkId = body.trackedLinkId;
      const urls = Array.isArray(body.urls) ? body.urls.filter((u) => u && u.url) : [];
      if (!trackedLinkId) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'trackedLinkId is required.' }) };
      if (!urls.length) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'At least one URL is required.' }) };
      if (!(await assertOwnership(trackedLinkId, effectiveUserId))) {
        return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Tracked link not found.' }) };
      }

      const countResult = await query('SELECT COUNT(*)::int AS n FROM tracked_link_destinations WHERE tracked_link_id = $1', [trackedLinkId]);
      let nextOrder = countResult.rows[0].n;

      const inserted = [];
      for (const u of urls) {
        const d = await query(
          'INSERT INTO tracked_link_destinations (tracked_link_id, url, weight, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
          [trackedLinkId, u.url, u.weight || 1, nextOrder++]
        );
        inserted.push(d.rows[0]);
      }

      // Adding a 2nd+ destination promotes a "single" link to weighted rotation.
      const linkResult = await query('SELECT mode FROM tracked_links WHERE id = $1', [trackedLinkId]);
      if (linkResult.rows[0]?.mode === 'single' && (nextOrder) > 1) {
        await query("UPDATE tracked_links SET mode = 'weighted' WHERE id = $1", [trackedLinkId]);
      }

      return { statusCode: 200, body: JSON.stringify({ success: true, destinations: inserted }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };
      const destResult = await query('SELECT tracked_link_id FROM tracked_link_destinations WHERE id = $1', [id]);
      const trackedLinkId = destResult.rows[0]?.tracked_link_id;
      if (!trackedLinkId || !(await assertOwnership(trackedLinkId, effectiveUserId))) {
        return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Not found.' }) };
      }
      await query('DELETE FROM tracked_link_destinations WHERE id = $1', [id]);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST or DELETE.' }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
