// lib/db.js — shared Postgres pool for all Netlify Functions.
// Uses Netlify DB's connection string when available (auto-injected by Netlify),
// falling back to a manually-set DATABASE_URL for any other Postgres provider.

const { Pool } = require('pg');
let getConnectionString;
try {
  ({ getConnectionString } = require('@netlify/database'));
} catch {
  getConnectionString = null;
}

let pool;

function resolveConnectionString() {
  console.error('DIAG: getConnectionString typeof =', typeof getConnectionString);
  if (getConnectionString) {
    try {
      const cs = getConnectionString();
      console.error('DIAG: getConnectionString() truthy?', !!cs, 'len=', cs ? cs.length : 0);
      if (cs) return cs;
    } catch (e) {
      console.error('DIAG: getConnectionString() threw:', e.message);
    }
  }
  const envKeys = Object.keys(process.env).filter(k => /DATABASE|NETLIFY_DB|POSTGRES|NEON/i.test(k));
  console.error('DIAG: candidate env keys found:', JSON.stringify(envKeys));
  console.error('DIAG: DATABASE_URL set?', !!process.env.DATABASE_URL);
  console.error('DIAG: NETLIFY_DATABASE_URL set?', !!process.env.NETLIFY_DATABASE_URL);
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED;
}

function getPool() {
  if (!pool) {
    const connectionString = resolveConnectionString();
    if (!connectionString) {
      console.error('DIAG: NO_DATABASE_CONFIGURED thrown');
      throw new Error('NO_DATABASE_CONFIGURED');
    }
    pool = new Pool({
      connectionString,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

module.exports = { getPool, query };
