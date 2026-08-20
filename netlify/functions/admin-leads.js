// netlify/functions/admin-leads.js — admin-only CRM view over captured leads,
// plus a manual "resync to Kit" action for leads that failed to push earlier.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

async function assertAdmin(payload) {
  const result = await query('SELECT is_admin FROM users WHERE id = $1', [payload.sub]);
  return !!result.rows[0]?.is_admin;
}

async function pushToKit(email, name, tag) {
  const KIT_API_KEY = process.env.KIT_API_KEY;
  const KIT_FORM_ID = process.env.KIT_FORM_ID;
  if (!KIT_API_KEY || !KIT_FORM_ID) return { synced: false, reason: 'NOT_CONFIGURED' };
  try {
    const res = await fetch(`https://api.kit.com/v4/forms/${KIT_FORM_ID}/subscribers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kit-Api-Key': KIT_API_KEY },
      body: JSON.stringify({ email_address: email, first_name: name || undefined, fields: tag ? { source_tag: tag } : undefined }),
    });
    if (!res.ok) return { synced: false, reason: `HTTP_${res.status}` };
    return { synced: true };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  try {
    if (!(await assertAdmin(payload))) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin access required.' }) };
    }

    if (event.httpMethod === 'GET') {
      const result = await query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 1000');
      return { statusCode: 200, body: JSON.stringify({ success: true, leads: result.rows }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.action !== 'resync') {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Unknown action.' }) };
      }
      const unsynced = await query('SELECT * FROM leads WHERE synced_to_kit = FALSE LIMIT 200');
      let succeeded = 0, failed = 0;
      for (const lead of unsynced.rows) {
        const result = await pushToKit(lead.email, lead.name, lead.tag);
        if (result.synced) {
          await query('UPDATE leads SET synced_to_kit = TRUE WHERE id = $1', [lead.id]);
          succeeded++;
        } else {
          failed++;
        }
      }
      return { statusCode: 200, body: JSON.stringify({ success: true, attempted: unsynced.rows.length, succeeded, failed }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use GET or POST.' }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
