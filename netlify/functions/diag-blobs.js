// netlify/functions/diag-blobs.js — TEMPORARY, remove after verifying.
const { getImageStore } = require('../../lib/ai-image');

exports.handler = async () => {
  try {
    const store = getImageStore();
    const testKey = 'diag-test-' + Date.now();
    await store.set(testKey, Buffer.from('hello-blobs'), { metadata: { contentType: 'text/plain' } });
    const readBack = await store.get(testKey, { type: 'text' });
    await store.delete(testKey);
    return { statusCode: 200, body: JSON.stringify({ success: true, wrote: 'hello-blobs', readBack, match: readBack === 'hello-blobs' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
