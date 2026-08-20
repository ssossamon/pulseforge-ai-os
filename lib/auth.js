// lib/auth.js — password hashing + JWT session helpers.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('NO_JWT_SECRET');
  return secret;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, tier: user.tier, isAdmin: user.is_admin },
    getSecret(),
    { expiresIn: '30d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

// Returns the decoded token payload, or null. Does NOT hit the database —
// callers that need fresh tier/admin state should re-fetch the user row.
function requireAuth(event) {
  const token = getBearerToken(event);
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, getBearerToken, requireAuth };
