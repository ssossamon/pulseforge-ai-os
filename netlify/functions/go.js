// netlify/functions/go.js — public redirect endpoint, no auth (anyone
// clicking the tracked link hits this). Picks a destination per the link's
// mode, logs the click, and drops a visit token (cookie + query param
// fallback) so a later conversion ping can be attributed to the correct
// destination variant.
const crypto = require('crypto');
const { query } = require('../../lib/db');

function weightedPick(destinations) {
  const total = destinations.reduce((s, d) => s + Math.max(1, d.weight), 0);
  let r = Math.random() * total;
  for (const d of destinations) {
    r -= Math.max(1, d.weight);
    if (r <= 0) return d;
  }
  return destinations[destinations.length - 1];
}

exports.handler = async (event) => {
  const slug = event.queryStringParameters?.slug;
  if (!slug) return { statusCode: 400, body: 'Missing slug.' };

  try {
    const linkResult = await query('SELECT * FROM tracked_links WHERE slug = $1', [slug]);
    const link = linkResult.rows[0];
    if (!link) return { statusCode: 404, body: 'Link not found.' };

    const destResult = await query('SELECT * FROM tracked_link_destinations WHERE tracked_link_id = $1 ORDER BY sort_order', [link.id]);
    const destinations = destResult.rows;
    if (!destinations.length) return { statusCode: 404, body: 'This link has no destination configured yet.' };

    let chosen;
    if (link.winner_destination_id) {
      chosen = destinations.find((d) => d.id === link.winner_destination_id) || destinations[0];
    } else if (destinations.length === 1) {
      chosen = destinations[0];
    } else if (link.mode === 'rotate') {
      const idx = link.current_index % destinations.length;
      chosen = destinations[idx];
      await query('UPDATE tracked_links SET current_index = $1 WHERE id = $2', [(idx + 1) % destinations.length, link.id]);
    } else {
      // 'weighted' or 'split' — random pick proportional to weight.
      chosen = weightedPick(destinations);
    }

    // Log the click.
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    const userAgent = (event.headers['user-agent'] || '').slice(0, 500);
    const referer = (event.headers['referer'] || event.headers['referrer'] || '').slice(0, 500);

    await query('INSERT INTO tracked_link_clicks (tracked_link_id, destination_id, ip_address, user_agent, referer) VALUES ($1,$2,$3,$4,$5)', [link.id, chosen.id, ip, userAgent, referer]);
    await query('UPDATE tracked_link_destinations SET click_count = click_count + 1 WHERE id = $1', [chosen.id]);

    // Visit token for conversion attribution — only meaningful (and only
    // created) when there's more than one destination to distinguish between.
    let destinationUrl = chosen.url;
    if (destinations.length > 1 && !link.winner_destination_id) {
      const visitToken = crypto.randomBytes(16).toString('hex');
      await query('INSERT INTO tracked_link_visits (visit_token, tracked_link_id, destination_id) VALUES ($1,$2,$3)', [visitToken, link.id, chosen.id]);
      const sep = destinationUrl.includes('?') ? '&' : '?';
      destinationUrl = `${destinationUrl}${sep}pfai_v=${visitToken}`;

      return {
        statusCode: 302,
        headers: {
          Location: destinationUrl,
          'Set-Cookie': `pfai_visit_${link.id}=${visitToken}; Max-Age=2592000; Path=/; SameSite=Lax`,
        },
      };
    }

    return { statusCode: 302, headers: { Location: destinationUrl } };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') return { statusCode: 501, body: 'Database not configured yet.' };
    return { statusCode: 500, body: 'Redirect error: ' + err.message };
  }
};
