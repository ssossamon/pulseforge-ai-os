// lib/social-post-helpers.js — real posting calls to each connected
// platform, shared by the manual "Post now" endpoint and the automated
// post-on-generate flow.

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

async function postToFacebook(connection, content) {
  if (!connection.platform_account_id) {
    return { success: false, error: 'Facebook connection is missing a Page. Reconnect your account in Settings.' };
  }
  const url = `https://graph.facebook.com/v19.0/${connection.platform_account_id}/feed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: content, access_token: connection.access_token }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data?.error?.code === 190) return { success: false, error: 'Facebook connection expired. Reconnect your account in Settings.' };
    return { success: false, error: `Facebook rejected the post: ${data?.error?.message || 'unknown error'}` };
  }
  return { success: true, url: `https://facebook.com/${data.id}` };
}

async function postToThreads(connection, content) {
  if (!connection.platform_account_id) {
    return { success: false, error: 'Threads connection is missing account info. Reconnect your account in Settings.' };
  }
  const base = `https://graph.threads.net/v1.0/${connection.platform_account_id}`;
  try {
    const createRes = await fetch(`${base}/threads?${new URLSearchParams({
      media_type: 'TEXT', text: content.slice(0, 500), access_token: connection.access_token,
    })}`, { method: 'POST' });
    const createData = await createRes.json();
    if (!createRes.ok) {
      if (createData?.error?.code === 190) return { success: false, error: 'Threads connection expired. Reconnect your account in Settings.' };
      return { success: false, error: `Threads rejected the post: ${createData?.error?.message || 'unknown error'}` };
    }
    const publishRes = await fetch(`${base}/threads_publish?${new URLSearchParams({
      creation_id: createData.id, access_token: connection.access_token,
    })}`, { method: 'POST' });
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return { success: false, error: `Threads publish failed: ${publishData?.error?.message || 'unknown error'}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: `Could not reach Threads: ${err.message}` };
  }
}

const POSTERS = { x: postToX, linkedin: postToLinkedIn, facebook: postToFacebook, threads: postToThreads };

async function postToPlatform(platform, connection, content) {
  const fn = POSTERS[platform];
  if (!fn) return { success: false, error: `Unsupported platform "${platform}".` };
  return fn(connection, content);
}

module.exports = { postToPlatform, POSTERS };
