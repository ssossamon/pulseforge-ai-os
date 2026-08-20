// lib/db.js — shared Postgres pool for all Netlify Functions.
// Netlify Database does not auto-inject a connection string into Function
// runtime env vars (confirmed via Netlify's own troubleshooting docs), so
// DATABASE_URL must be set manually from the database branch's "Read and
// write" connection string (Database -> production -> Connect).
const { Pool } = require('pg');
let getConnectionString;
try {
  ({ getConnectionString } = require('@netlify/database'));
} catch {
  getConnectionString = null;
}

let pool;

function resolveConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (getConnectionString) {
    try {
      const cs = getConnectionString();
      if (cs) return cs;
    } catch {
      // fall through
    }
  }
  return process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED;
}

function getPool() {
  if (!pool) {
    const connectionString = resolveConnectionString();
    if (!connectionString) {
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
