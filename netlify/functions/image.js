// netlify/functions/image.js — serves a generated campaign image.
// Public read (no auth) since these are just images referenced from a
// user's own generated content — same trust model as any hosted image URL.
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, body: 'Missing id.' };

  try {
    const store = getStore('campaign-images');
    const data = await store.get(id, { type: 'arrayBuffer' });
    if (!data) return { statusCode: 404, body: 'Image not found.' };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: Buffer.from(data).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: 'Could not load image: ' + err.message };
  }
};
