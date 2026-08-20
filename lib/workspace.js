// lib/workspace.js — resolves which user_id a request should operate
// against. Team members share the owner's campaign workspace; everyone
// else operates on their own account.
const { query } = require('./db');

async function getEffectiveUserId(authUserId) {
  const result = await query('SELECT team_owner_id FROM users WHERE id = $1', [authUserId]);
  const teamOwnerId = result.rows[0]?.team_owner_id;
  return teamOwnerId || authUserId;
}

module.exports = { getEffectiveUserId };
