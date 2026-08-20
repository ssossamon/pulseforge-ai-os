// netlify/functions/brand-voices.js — GET (list), POST (create), DELETE (?id=)
// Shared across a team workspace, same as campaigns/templates.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { getEffectiveUserId } = require('../../lib/workspace');

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    const effectiveUserId = await getEffectiveUserId(payload.sub);

    if (event.httpMethod === 'GET') {
      const result = await query('SELECT * FROM brand_voices WHERE user_id = $1 ORDER BY created_at DESC', [effectiveUserId]);
      return { statusCode: 200, body: JSON.stringify({ success: true, voices: result.rows }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const name = (body.name || '').trim();
      if (!name) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Name is required.' }) };
      const result = await query(
        `INSERT INTO brand_voices (user_id, name, tone_notes, signature_phrases, banned_words)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [effectiveUserId, name, body.toneNotes || null, body.signaturePhrases || null, body.bannedWords || null]
      );
      return { statusCode: 200, body: JSON.stringify({ success: true, voice: result.rows[0] }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'id is required.' }) };
      const result = await query('DELETE FROM brand_voices WHERE id = $1 AND user_id = $2 RETURNING id', [id, effectiveUserId]);
      if (result.rows.length === 0) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Not found.' }) };
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
