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
  if (getConnectionString) {
    try {
      const cs = getConnectionString();
      if (cs) return cs;
    } catch {
      // fall through to env var
    }
  }
  return process.env.DATABASE_URL;
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
