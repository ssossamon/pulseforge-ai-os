// netlify/functions/social-callback-x.js — X OAuth 2.0 callback.
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

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=not_configured` } };
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: statePayload.redirectUri,
        code_verifier: statePayload.verifier,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}` } };
    }

    // Fetch the connected account's handle for display purposes.
    let accountLabel = 'Connected';
    try {
      const meRes = await fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const meData = await meRes.json();
      if (meData?.data?.username) accountLabel = '@' + meData.data.username;
    } catch { /* label is cosmetic, ignore failures */ }

    const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
    await query(
      `INSERT INTO social_connections (user_id, platform, access_token, refresh_token, expires_at, account_label)
       VALUES ($1, 'x', $2, $3, $4, $5)
       ON CONFLICT (user_id, platform) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at, account_label = EXCLUDED.account_label`,
      [statePayload.userId, tokenData.access_token, tokenData.refresh_token || null, expiresAt, accountLabel]
    );

    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_connected=x` } };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(err.message)}` } };
  }
};
