// netlify/functions/social-connect-x.js — starts the X OAuth 2.0 PKCE flow.
// Requires env vars: X_CLIENT_ID, X_CLIENT_SECRET (from a Twitter/X Developer
// App with OAuth 2.0 enabled, "tweet.write" + "tweet.read" + "users.read" +
// "offline.access" scopes, and this function's own URL registered as a
// callback: https://<your-domain>/.netlify/functions/social-callback-x
const { requireAuth } = require('../../lib/auth');
const { generatePkce, signState } = require('../../lib/social-oauth');

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 400, body: 'Missing token.' };

  // Reuse requireAuth's verification by faking the header shape it expects.
  const payload = requireAuth({ headers: { authorization: `Bearer ${token}` } });
  if (!payload) return { statusCode: 401, body: 'Invalid or expired session — go back and sign in again.' };

  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) {
    return {
      statusCode: 501,
      body: 'X (Twitter) connections are not configured on this site yet. The site owner needs to register a Twitter Developer App and set X_CLIENT_ID / X_CLIENT_SECRET.',
    };
  }

  const siteUrl = `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/social-callback-x`;
  const { verifier, challenge } = generatePkce();
  const state = signState({ userId: payload.sub, verifier, redirectUri });

  const authorizeUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return { statusCode: 302, headers: { Location: authorizeUrl.toString() } };
};
