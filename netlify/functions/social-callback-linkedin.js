// netlify/functions/social-callback-linkedin.js — LinkedIn OAuth 2.0 callback.
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

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=not_configured` } };
  }

  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: statePayload.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}` } };
    }

    // LinkedIn posts require the member's URN (from OpenID userinfo), so
    // fetch and store it alongside the token — needed at post time.
    let accountLabel = 'Connected';
    let memberUrn = null;
    try {
      const meRes = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const meData = await meRes.json();
      if (meData?.name) accountLabel = meData.name;
      if (meData?.sub) memberUrn = `urn:li:person:${meData.sub}`;
    } catch { /* label/urn best-effort */ }

    const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
    await query(
      `INSERT INTO social_connections (user_id, platform, access_token, refresh_token, platform_account_id, expires_at, account_label)
       VALUES ($1, 'linkedin', $2, NULL, $3, $4, $5)
       ON CONFLICT (user_id, platform) DO UPDATE SET access_token = EXCLUDED.access_token, platform_account_id = EXCLUDED.platform_account_id, expires_at = EXCLUDED.expires_at, account_label = EXCLUDED.account_label`,
      [statePayload.userId, tokenData.access_token, memberUrn, expiresAt, accountLabel]
    );

    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_connected=linkedin` } };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(err.message)}` } };
  }
};
