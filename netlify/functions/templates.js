// netlify/functions/templates.js — GET (list), POST (create), DELETE (?id=)
// GET returns built-in starter templates (shared, user_id IS NULL) plus the
// workspace's own saved templates. Built-ins can never be deleted or edited
// since the DELETE/owner check requires a matching user_id.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { getEffectiveUserId } = require('../../lib/workspace');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);

    if (event.httpMethod === 'GET') {
      const result = await query(
        `SELECT * FROM campaign_templates
         WHERE is_builtin = TRUE OR user_id = $1
         ORDER BY is_builtin DESC, created_at DESC`,
        [effectiveUserId]
      );
      return { statusCode: 200, body: JSON.stringify({ success: true, templates: result.rows }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const name = (body.name || '').trim();
      if (!name) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Template name is required.' }) };
      const result = await query(
        `INSERT INTO campaign_templates (user_id, name, offer_url, target_audience, main_benefit, tone, language, platforms, asset_modules)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          effectiveUserId, name,
          body.offerUrl || null, body.targetAudience || null, body.mainBenefit || null,
          body.tone || 'direct', body.language || 'en',
          body.platforms || [], body.modules || [],
        ]
      );
      return { statusCode: 200, body: JSON.stringify({ success: true, template: result.rows[0] }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };
      // user_id match fails for built-ins (user_id IS NULL), so this can never delete a shared starter.
      const result = await query('DELETE FROM campaign_templates WHERE id = $1 AND user_id = $2 RETURNING id', [id, effectiveUserId]);
      if (result.rows.length === 0) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Not found, or this is a built-in template that can\'t be deleted.' }) };
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use GET, POST, or DELETE.' }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
