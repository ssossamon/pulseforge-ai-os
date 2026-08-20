// netlify/functions/social-connect-threads.js — starts the Threads API OAuth flow.
// Requires env vars: THREADS_CLIENT_ID, THREADS_CLIENT_SECRET (from a Meta
// Developer App with the Threads API product added, "threads_basic" +
// "threads_content_publish" permissions, and this function's URL registered
// as a redirect URI: https://<your-domain>/.netlify/functions/social-callback-threads
const { requireAuth } = require('../../lib/auth');
const { signState } = require('../../lib/social-oauth');

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 400, body: 'Missing token.' };

  const payload = requireAuth({ headers: { authorization: `Bearer ${token}` } });
  if (!payload) return { statusCode: 401, body: 'Invalid or expired session — go back and sign in again.' };

  const clientId = process.env.THREADS_CLIENT_ID;
  if (!clientId) {
    return {
      statusCode: 501,
      body: 'Threads connections are not configured on this site yet. The site owner needs to register a Meta Developer App with the Threads API product and set THREADS_CLIENT_ID / THREADS_CLIENT_SECRET.',
    };
  }

  const siteUrl = `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/social-callback-threads`;
  const state = signState({ userId: payload.sub, redirectUri });

  const authorizeUrl = new URL('https://threads.net/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'threads_basic,threads_content_publish');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('response_type', 'code');

  return { statusCode: 302, headers: { Location: authorizeUrl.toString() } };
};
