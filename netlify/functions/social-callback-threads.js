// netlify/functions/social-callback-threads.js — Threads API OAuth callback.
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

  const clientId = process.env.THREADS_CLIENT_ID;
  const clientSecret = process.env.THREADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=not_configured` } };
  }

  try {
    const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: statePayload.redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(tokenData?.error_message || 'token_exchange_failed')}` } };
    }

    let accountLabel = 'Connected';
    try {
      const meRes = await fetch(`https://graph.threads.net/v1.0/me?fields=username&access_token=${tokenData.access_token}`);
      const meData = await meRes.json();
      if (meData?.username) accountLabel = '@' + meData.username;
    } catch { /* label best-effort */ }

    await query(
      `INSERT INTO social_connections (user_id, platform, access_token, platform_account_id, account_label)
       VALUES ($1, 'threads', $2, $3, $4)
       ON CONFLICT (user_id, platform) DO UPDATE SET access_token = EXCLUDED.access_token, platform_account_id = EXCLUDED.platform_account_id, account_label = EXCLUDED.account_label`,
      [statePayload.userId, tokenData.access_token, String(tokenData.user_id), accountLabel]
    );

    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_connected=threads` } };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/app.html?social_error=${encodeURIComponent(err.message)}` } };
  }
};
