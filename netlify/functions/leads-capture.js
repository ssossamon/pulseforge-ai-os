// netlify/functions/leads-capture.js — public endpoint used by the landing
// page and in-app subscribe forms. Always records the lead in the CRM leads
// table first (source of truth), then best-effort pushes it to Kit
// (ConvertKit). If Kit isn't configured or the push fails, the lead is still
// saved and marked synced_to_kit = false — an admin can retry via
// leads-resync. We never fake a Kit success.
const { query } = require('../../lib/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function pushToKit(email, firstName, tag) {
  const KIT_API_KEY = process.env.KIT_API_KEY;
  const KIT_FORM_ID = process.env.KIT_FORM_ID;
  if (!KIT_API_KEY || !KIT_FORM_ID) return { synced: false, reason: 'NOT_CONFIGURED' };

  try {
    const res = await fetch(`https://api.kit.com/v4/forms/${KIT_FORM_ID}/subscribers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kit-Api-Key': KIT_API_KEY },
      body: JSON.stringify({ email_address: email, first_name: firstName || undefined, fields: tag ? { source_tag: tag } : undefined }),
    });
    if (!res.ok) return { synced: false, reason: `HTTP_${res.status}` };
    return { synced: true };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body.' }) };
  }
  const email = (body.email || '').trim().toLowerCase();
  const name = (body.name || '').trim() || null;
  const tag = (body.tag || '').trim() || null;
  const source = (body.source || 'unknown').trim();

  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ success: false, code: 'BAD_EMAIL', error: 'Enter a valid email address.' }) };
  }

  try {
    const kitResult = await pushToKit(email, name, tag);
    await query(
      'INSERT INTO leads (email, name, source, tag, synced_to_kit) VALUES ($1, $2, $3, $4, $5)',
      [email, name, source, tag, kitResult.synced]
    );
    return { statusCode: 200, body: JSON.stringify({ success: true, syncedToKit: kitResult.synced }) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      // Still try to at least get them into Kit even if our own DB isn't up yet.
      const kitResult = await pushToKit(email, name, tag);
      if (kitResult.synced) return { statusCode: 200, body: JSON.stringify({ success: true, syncedToKit: true, code: 'DB_UNAVAILABLE' }) };
      return { statusCode: 501, body: JSON.stringify({ success: false, code: 'NOT_CONFIGURED', error: 'Lead capture is not fully configured yet on this deployment.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
