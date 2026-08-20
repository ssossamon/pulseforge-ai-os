// netlify/functions/social-post.js — publishes real content to a connected
// social account using that user's own stored OAuth token. Real API calls
// only; if the connection is missing/expired, returns a clear error rather
// than pretending it posted.
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

async function postToX(connection, content) {
  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.access_token}` },
    body: JSON.stringify({ text: content.slice(0, 280) }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) return { success: false, error: 'X connection expired. Reconnect your account in Settings.' };
    return { success: false, error: `X rejected the post: ${data?.detail || data?.title || 'unknown error'}` };
  }
  return { success: true, url: `https://x.com/i/web/status/${data.data.id}` };
}

async function postToLinkedIn(connection, content) {
  if (!connection.platform_account_id) {
    return { success: false, error: 'LinkedIn connection is missing account info. Reconnect your account in Settings.' };
  }
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${connection.access_token}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: connection.platform_account_id,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) return { success: false, error: 'LinkedIn connection expired. Reconnect your account in Settings.' };
    return { success: false, error: `LinkedIn rejected the post: ${data?.message || 'unknown error'}` };
  }
  return { success: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Use POST.' }) };
  }
  const payload = requireAuth(event);
  if (!payload) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not signed in.' }) };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body.' }) };
  }
  const { platform, content } = body;
  if (!['x', 'linkedin'].includes(platform)) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'platform must be "x" or "linkedin".' }) };
  }
  if (!content || !content.trim()) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'No content to post.' }) };
  }

  try {
    const connResult = await query('SELECT * FROM social_connections WHERE user_id = $1 AND platform = $2', [payload.sub, platform]);
    const connection = connResult.rows[0];
    if (!connection) {
      return { statusCode: 404, body: JSON.stringify({ success: false, code: 'NOT_CONNECTED', error: `You haven't connected a ${platform === 'x' ? 'X' : 'LinkedIn'} account yet. Connect it in Settings.` }) };
    }

    const result = platform === 'x' ? await postToX(connection, content) : await postToLinkedIn(connection, content);
    return { statusCode: result.success ? 200 : 502, body: JSON.stringify(result) };
  } catch (err) {
    if (err.message === 'NO_DATABASE_CONFIGURED') {
      return { statusCode: 501, body: JSON.stringify({ success: false, error: 'Database not configured yet.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
