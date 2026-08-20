// lib/social-oauth.js — shared helpers for X/LinkedIn OAuth connect flows.
// OAuth "authorize" redirects are plain browser navigations (no custom
// headers), so we can't send a Bearer token the normal way. Instead the
// connect endpoint accepts the JWT as a query param, verifies it, then
// embeds the user id + PKCE code_verifier into a short-lived signed JWT
// used as the OAuth `state` parameter — verified again on callback.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('NO_JWT_SECRET');
  return secret;
}

function base64url(input) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function signState(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '10m' });
}

function verifyState(state) {
  return jwt.verify(state, getSecret());
}

module.exports = { generatePkce, signState, verifyState };
