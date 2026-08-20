// netlify/functions/social-callback-facebook.js — Facebook OAuth callback.
// Posting requires a Page (not a personal profile), so after getting the
// user token we fetch their managed Pages and store the first one's
// page-scoped token. Multi-page selection is a future enhancement — for
// now this covers the common case of one business Page per account.
const { query } = require('../../lib/db');
const { verifyState } = require('../../lib/social-oauth');

exports.handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};
  const siteUrl = `https://${event.headers.host}`;

  if (error) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(error)}` } };
  }
  if (!code || !state) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=missing_code` } };
  }

  let statePayload;
  try {
    statePayload = verifyState(state);
  } catch {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=invalid_or_expired_state` } };
  }

  const clientId = process.env.FACEBOOK_CLIENT_ID;
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=not_configured` } };
  }

  try {
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', clientId);
    tokenUrl.searchParams.set('client_secret', clientSecret);
    tokenUrl.searchParams.set('redirect_uri', statePayload.redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(tokenData?.error?.message || 'token_exchange_failed')}` } };
    }

    // Fetch the Pages this user manages; use the first one.
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${tokenData.access_token}`);
    const pagesData = await pagesRes.json();
    const page = pagesData?.data?.[0];
    if (!page) {
      return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent('No Facebook Page found on this account. You need to manage at least one Page to post.')}` } };
    }

    await query(
      `INSERT INTO social_connections (user_id, platform, access_token, platform_account_id, account_label)
       VALUES ($1, 'facebook', $2, $3, $4)
       ON CONFLICT (user_id, platform) DO UPDATE SET access_token = EXCLUDED.access_token, platform_account_id = EXCLUDED.platform_account_id, account_label = EXCLUDED.account_label`,
      [statePayload.userId, page.access_token, page.id, page.name || 'Connected']
    );

    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_connected=facebook` } };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(err.message)}` } };
  }
};
