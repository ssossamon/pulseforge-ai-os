// netlify/functions/integrations-status.js — admin-only. Every status here is
// a real check, not an assumption: the database check runs an actual query,
// the Kit check confirms env vars are present (a live subscriber write is
// destructive so we don't test-fire it here — the leads-capture flow itself
// is the real end-to-end test).
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

async function assertAdmin(payload) {
  const result = await query('SELECT is_admin FROM users WHERE id = $1', [payload.sub]);
  return !!result.rows[0]?.is_admin;
}

exports.handler = async (event) => {
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  const status = {
    database: { ok: false, detail: '' },
    jwt: { ok: !!process.env.JWT_SECRET, detail: process.env.JWT_SECRET ? 'JWT_SECRET is set.' : 'JWT_SECRET is missing — sign in/register will fail.' },
    kit: { ok: false, detail: '' },
    ownerEmail: { ok: !!process.env.OWNER_EMAIL, detail: process.env.OWNER_EMAIL ? `Owner email set to ${process.env.OWNER_EMAIL}.` : 'OWNER_EMAIL not set — no account will get automatic admin access.' },
  };

  try {
    await query('SELECT is_admin FROM users WHERE id = $1', [payload.sub]).then((r) => {
      if (!r.rows[0]?.is_admin) throw new Error('FORBIDDEN');
    });
  } catch (err) {
    if (err.message === 'FORBIDDEN') {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin access required.' }) };
    }
    status.database = { ok: false, detail: `Database check failed: ${err.message}` };
    return { statusCode: 200, body: JSON.stringify({ success: true, status }) };
  }

  try {
    await query('SELECT 1');
    status.database = { ok: true, detail: 'Connected — a live query succeeded.' };
  } catch (err) {
    status.database = { ok: false, detail: err.message === 'NO_DATABASE_CONFIGURED' ? 'No database connected yet.' : `Query failed: ${err.message}` };
  }

  status.kit = process.env.KIT_API_KEY && process.env.KIT_FORM_ID
    ? { ok: true, detail: 'KIT_API_KEY and KIT_FORM_ID are both set.' }
    : { ok: false, detail: 'Missing KIT_API_KEY and/or KIT_FORM_ID — lead capture will save to the CRM but not push to Kit.' };

  return { statusCode: 200, body: JSON.stringify({ success: true, status }) };
};
