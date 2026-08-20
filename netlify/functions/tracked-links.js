// netlify/functions/tracked-links.js — GET (list, ?campaignId= optional),
// POST (create with initial destinations), DELETE (?id=)
const crypto = require('crypto');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { getEffectiveUserId } = require('../../lib/workspace');

function makeSlug() {
  return crypto.randomBytes(4).toString('base64url');
}

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);

    if (event.httpMethod === 'GET') {
      const campaignId = event.queryStringParameters?.campaignId;
      const result = campaignId
        ? await query('SELECT * FROM tracked_links WHERE user_id = $1 AND campaign_id = $2 ORDER BY created_at DESC', [effectiveUserId, campaignId])
        : await query('SELECT * FROM tracked_links WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [effectiveUserId]);

      const links = result.rows;
      if (links.length) {
        const ids = links.map((l) => l.id);
        const destResult = await query('SELECT * FROM tracked_link_destinations WHERE tracked_link_id = ANY($1) ORDER BY sort_order', [ids]);
        links.forEach((l) => { l.destinations = destResult.rows.filter((d) => d.tracked_link_id === l.id); });
      }
      return { statusCode: 200, body: JSON.stringify({ success: true, links }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const name = (body.name || '').trim();
      const campaignId = body.campaignId || null;
      const urls = Array.isArray(body.urls) ? body.urls.filter((u) => u && u.url) : [];
      if (!name) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Name is required.' }) };
      if (!urls.length) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'At least one destination URL is required.' }) };

      let slug, inserted = false, attempts = 0, linkResult;
      while (!inserted && attempts < 5) {
        slug = makeSlug();
        try {
          linkResult = await query(
            `INSERT INTO tracked_links (user_id, campaign_id, name, slug, mode)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [effectiveUserId, campaignId, name, slug, urls.length > 1 ? (body.mode || 'weighted') : 'single']
          );
          inserted = true;
        } catch (err) {
          if (err.code === '23505') { attempts++; continue; }
          throw err;
        }
      }
      if (!inserted) return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Could not generate a unique slug. Try again.' }) };

      const link = linkResult.rows[0];
      const destRows = [];
      for (let i = 0; i < urls.length; i++) {
        const d = await query(
          'INSERT INTO tracked_link_destinations (tracked_link_id, url, weight, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
          [link.id, urls[i].url, urls[i].weight || 1, i]
        );
        destRows.push(d.rows[0]);
      }
      link.destinations = destRows;

      return { statusCode: 200, body: JSON.stringify({ success: true, link }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };
      const result = await query('DELETE FROM tracked_links WHERE id = $1 AND user_id = $2 RETURNING id', [id, effectiveUserId]);
      if (result.rows.length === 0) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Not found.' }) };
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use GET, POST, or DELETE.' }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    if (err.code === '23503') {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'That campaign no longer exists — refresh and try again.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
