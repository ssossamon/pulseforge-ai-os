// netlify/functions/social-connect-linkedin.js — starts the LinkedIn OAuth 2.0 flow.
// Requires env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET (from a
// LinkedIn Developer App with "Share on LinkedIn" + "Sign In with LinkedIn
// using OpenID Connect" products added, scopes w_member_social + openid +
// profile, and this function's URL registered as a redirect URL:
// https://<your-domain>/.netlify/functions/social-callback-linkedin
const { requireAuth } = require('../../lib/auth');
const { signState } = require('../../lib/social-oauth');

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 400, body: 'Missing token.' };

  const payload = requireAuth({ headers: { authorization: `Bearer ${token}` } });
  if (!payload) return { statusCode: 401, body: 'Invalid or expired session — go back and sign in again.' };

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return {
      statusCode: 501,
      body: 'LinkedIn connections are not configured on this site yet. The site owner needs to register a LinkedIn Developer App and set LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET.',
    };
  }

  const siteUrl = `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/social-callback-linkedin`;
  const state = signState({ userId: payload.sub, redirectUri });

  const authorizeUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'openid profile w_member_social');
  authorizeUrl.searchParams.set('state', state);

  return { statusCode: 302, headers: { Location: authorizeUrl.toString() } };
};
