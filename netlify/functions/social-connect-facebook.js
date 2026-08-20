// netlify/functions/social-connect-facebook.js — starts Facebook Login OAuth.
// Requires env vars: FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET (from a Meta
// Developer App with Facebook Login enabled, "pages_show_list",
// "pages_manage_posts", "pages_read_engagement" permissions approved, and
// this function's URL registered as a valid OAuth redirect URI:
// https://<your-domain>/.netlify/functions/social-callback-facebook
const { requireAuth } = require('../../lib/auth');
const { signState } = require('../../lib/social-oauth');

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 400, body: 'Missing token.' };

  const payload = requireAuth({ headers: { authorization: `Bearer ${token}` } });
  if (!payload) return { statusCode: 401, body: 'Invalid or expired session — go back and sign in again.' };

  const clientId = process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) {
    return {
      statusCode: 501,
      body: 'Facebook connections are not configured on this site yet. The site owner needs to register a Meta Developer App and set FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET.',
    };
  }

  const siteUrl = `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/social-callback-facebook`;
  const state = signState({ userId: payload.sub, redirectUri });

  const authorizeUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'pages_show_list,pages_manage_posts,pages_read_engagement');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('response_type', 'code');

  return { statusCode: 302, headers: { Location: authorizeUrl.toString() } };
};
