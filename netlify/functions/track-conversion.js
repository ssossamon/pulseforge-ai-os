// netlify/functions/track-conversion.js — public, no auth. Embed as a 1x1
// pixel or fire via JS/fetch on a thank-you page:
//   <img src="https://<site>/.netlify/functions/track-conversion?link=<id>&v=<visit-token>" width="1" height="1">
// The visit token comes from the cookie/query param `go.js` attached to the
// destination URL, so PulseForge users need to either pass the pfai_v query
// param through to their thank-you page, or read the pfai_visit_<linkId>
// cookie and include it. This is what makes auto-declare a real conversion
// signal instead of a click-volume guess.
const { getPool } = require('../../lib/db');

// 1x1 transparent PNG, served so the pixel embed always "works" visually
// even before/regardless of whether attribution succeeds.
const PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

exports.handler = async (event) => {
  const linkId = event.queryStringParameters?.link;
  const visitToken = event.queryStringParameters?.v;

  const pixelResponse = {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    body: PIXEL_PNG_BASE64,
    isBase64Encoded: true,
  };

  if (!linkId || !visitToken) return pixelResponse; // always return the pixel, even on bad params

  let client;
  try {
    const pool = getPool();
    client = await pool.connect();
    await client.query('BEGIN');

    const visitResult = await client.query('SELECT * FROM tracked_link_visits WHERE visit_token = $1 AND tracked_link_id = $2 FOR UPDATE', [visitToken, linkId]);
    const visit = visitResult.rows[0];
    if (!visit || visit.converted) {
      await client.query('ROLLBACK');
      return pixelResponse; // unknown token or already-counted conversion — idempotent, still return the pixel
    }

    await client.query('UPDATE tracked_link_visits SET converted = TRUE WHERE id = $1', [visit.id]);
    await client.query('UPDATE tracked_link_destinations SET conversion_count = conversion_count + 1 WHERE id = $1', [visit.destination_id]);
    await client.query('COMMIT');
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return pixelResponse; // never fail the pixel response even if attribution errored
  } finally {
    if (client) client.release();
  }

  // Auto-declare check — outside the transaction, best-effort.
  try {
    const linkResult = await getPool().query('SELECT * FROM tracked_links WHERE id = $1', [linkId]);
    const link = linkResult.rows[0];
    if (link && link.auto_declare && !link.winner_destination_id) {
      const destResult = await getPool().query('SELECT * FROM tracked_link_destinations WHERE tracked_link_id = $1', [linkId]);
      const destinations = destResult.rows;
      const eligible = destinations.filter((d) => d.conversion_count >= link.min_conversions_to_declare);
      if (eligible.length) {
        const winner = destinations.reduce((best, d) => {
          const rate = d.click_count > 0 ? d.conversion_count / d.click_count : 0;
          const bestRate = best.click_count > 0 ? best.conversion_count / best.click_count : 0;
          return rate > bestRate ? d : best;
        }, destinations[0]);
        await getPool().query('UPDATE tracked_links SET winner_destination_id = $1 WHERE id = $2', [winner.id, linkId]);
      }
    }
  } catch {
    // auto-declare is a nice-to-have; never let it affect the pixel response
  }

  return pixelResponse;
};
