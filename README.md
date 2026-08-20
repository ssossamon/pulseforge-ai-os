# PulseForge AI OS — v2.0 (Enterprise)

A full-stack campaign builder: real accounts, server-verified licensing, an admin
keygen system, and a leads CRM wired to Kit (ConvertKit) — deployed on Netlify with
Netlify DB (Postgres).

## One-line product statement
Create an account, paste an offer, and PulseForge AI OS builds a full campaign —
platform posts for X/Facebook/LinkedIn/Threads, viral hooks, CTAs, video hooks, and
email copy — using your own AI provider key. Admins get a keygen console, a user
directory, and a CRM of every captured lead.

## What changed from v1.0
v1.0 had no backend — license checks and usage caps were client-side only, which we
flagged as a known limitation. v2.0 closes that: real signup/login, a real Postgres
database, and license keys that are validated server-side against actual redemption
records, not just format-matched in the browser.

## File inventory
```
index.html                          Sales/landing page + lead capture
register.html / login.html          Create account / sign in
app.html                            Campaign builder (auth-gated)
admin.html                          Admin console (auth + is_admin gated)
shared.css                          Shared design system for all pages
netlify.toml                        Build/functions config
package.json                        Runtime deps for functions (pg, bcryptjs, jsonwebtoken, @netlify/database)
lib/db.js                           Shared Postgres pool
lib/auth.js                         Password hashing + JWT session helpers
lib/ai-provider.js                  Shared OpenAI/Anthropic/Gemini caller
lib/tiers.js                        Server-side source of truth for tier limits
netlify/database/migrations/001_init/migration.sql   Schema: users, license_keys, campaigns, assets, leads
netlify/functions/
  auth-register.js, auth-login.js, auth-me.js         Account system
  campaigns-create.js, campaigns-list.js,
  campaigns-get.js, campaigns-delete.js                Campaign builder + history
  keys-generate.js, keys-list.js, keys-redeem.js       Admin keygen + real redemption
  admin-users.js                                       Admin user directory + overrides
  admin-leads.js, leads-capture.js                     CRM + Kit sync
  integrations-status.js                               Admin live health checks
  test-connection.js                                   BYOK "test connection" button
```

## Architecture
- **Frontend**: static HTML/CSS/vanilla JS, no build step, no framework.
- **Backend**: Netlify Functions (Node), stateless, JWT-authenticated.
- **Database**: Postgres via Netlify DB (`@netlify/database`), accessed through
  the raw `pg` driver — no Prisma, so there's no engine-binary fetch step to break
  in restricted network environments.
- **Auth**: email + bcrypt-hashed password, 30-day JWT signed with `JWT_SECRET`,
  sent as `Authorization: Bearer <token>` on every authenticated request.
  `auth-me.js` re-reads the user row from the database on every check, so an
  admin changing your tier or role takes effect on your next page load without
  forcing a re-login.
- **Licensing**: `license_keys` table. Redeeming a key is an atomic transaction
  (`SELECT ... FOR UPDATE`) that flips the key to `redeemed`, records who redeemed
  it, and updates the user's tier — closing the earlier "format-check only" gap.
- **Tier enforcement**: happens **server-side** in `campaigns-create.js` against a
  fresh database read of the user's tier — never trusts the client's copy of the
  plan. `lib/tiers.js` is the single source of truth.
- **CRM**: every lead capture (landing page or in-app) writes to the `leads` table
  first, then best-effort pushes to Kit. If Kit isn't configured or the push fails,
  the lead is still saved with `synced_to_kit = false`, and an admin can retry via
  the CRM tab's "Resync unsynced leads to Kit" button.

## Deploying to Netlify

**Important:** this build now has real npm dependencies (`pg`, `bcryptjs`,
`jsonwebtoken`, `@netlify/database`) for the serverless functions.
**Netlify Drop does not run `npm install`** — if you drag-and-drop this folder,
`node_modules` must already be present inside it (it is, in the delivered zip).
For any ongoing development, use the GitHub path below instead, where Netlify
installs dependencies automatically on every build.

### 1. Push to GitHub, then import in Netlify
Netlify → **Add new site → Import an existing project → GitHub** → select the repo.
Build settings come from `netlify.toml` (publish `.`, functions `netlify/functions`)
— no build command needed for the static pages; Netlify installs `package.json`
dependencies automatically before bundling the functions.

### 2. Add a Netlify DB (Postgres)
In the Netlify UI: **Extensions → Netlify DB** (or **Add-ons**) → provision a
database for this site. This automatically makes `@netlify/database`'s
`getConnectionString()` work at runtime — no manual `DATABASE_URL` needed on
Netlify itself. The schema in `netlify/database/migrations/001_init/migration.sql`
is applied automatically before each deploy.

*(If you ever host the database elsewhere — Supabase, Neon, RDS — just set
`DATABASE_URL` as an env var instead; `lib/db.js` falls back to it automatically.)*

### 3. Set environment variables
Site settings → Environment variables:
| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | **Yes** | Signs session tokens. Use a long random string. Without this, register/login fail with a clear "not configured" error. |
| `OWNER_EMAIL` | Recommended | The email you'll register with. Registering with this exact email automatically makes that account `is_admin = true` and `tier = enterprise` — this is your real admin access, not a hardcoded key. |
| `KIT_API_KEY` | For lead capture | Your Kit (ConvertKit) v4 API key. |
| `KIT_FORM_ID` | For lead capture | The form/sequence ID leads get subscribed to. |

### 4. Get your admin access
1. Set `OWNER_EMAIL` to the email you want as admin (e.g.
   `reinvestclubjax@gmail.com`) and redeploy.
2. Go to `/register.html` and create an account with that exact email.
3. You're automatically `is_admin = true`, `tier = enterprise`. Sign in and you'll
   land on `/admin.html` instead of `/app.html`.

This is the *real* admin path. There's no hardcoded owner key baked into this
version's code, because a real backend now exists to verify it properly — the
owner-override pattern from v1.0 (client-side hardcoded key) is no longer needed or
appropriate once accounts are real.

## Licensing / keygen (admin)
- Log in as admin → **Keygen** tab → pick a tier (`starter` or `enterprise`) and a
  count → **Generate**. Keys look like `PFAI-STARTER-7K2M-9QXT`.
- Every generated key is a real row in `license_keys` with `status = 'unused'`.
- A buyer enters their key in the app's **License** tab. `keys-redeem.js` verifies
  the key exists and is unused, marks it redeemed, and upgrades their account —
  server-side, atomically, can't be spoofed by editing localStorage.
- **Users** tab in admin also lets you manually set anyone's tier or admin flag
  directly, for support cases or comps.

## CRM
- **CRM / Leads** tab in admin shows every captured email with source, tag, and
  Kit-sync status.
- If a lead shows "not synced," it means Kit wasn't configured yet when they signed
  up, or the push failed. Click **Resync unsynced leads to Kit** to retry all of
  them once `KIT_API_KEY`/`KIT_FORM_ID` are set correctly.

## Privacy
- AI provider API keys are BYOK: stored only in the browser's `localStorage`, sent
  per-request to `campaigns-create.js`/`test-connection.js`, forwarded directly to
  the chosen provider, and never written to the database or logged.
- Passwords are bcrypt-hashed (cost factor 10); plaintext passwords are never
  stored or logged.
- Session tokens are JWTs scoped to 30 days; there's no server-side session store to
  leak, but a leaked token is valid until expiry — rotate `JWT_SECRET` to invalidate
  all sessions at once if needed.

## Functional testing checklist
- [ ] `/register.html` creates an account; registering with `OWNER_EMAIL` grants admin + enterprise
- [ ] `/login.html` rejects wrong password with a real error, not a crash
- [ ] `/app.html` redirects to login when not signed in
- [ ] `/admin.html` redirects non-admins to `/app.html`
- [ ] Free tier: platform/module chips for LinkedIn, Threads, viral hooks, CTAs, video hooks are disabled
- [ ] Free tier: 4th campaign attempt is blocked server-side with a clear message (not just client-side)
- [ ] Starter tier: 6th campaign in one day is blocked server-side
- [ ] Campaign generation with a real BYOK key produces real per-module assets, saved to history
- [ ] Malformed AI JSON falls back to showing raw text, not a crash
- [ ] Export TXT / CSV / PDF each produce a real, openable file
- [ ] Admin → Keygen generates real keys; redeeming one in the app immediately upgrades the tier
- [ ] Redeeming an already-used key returns "already redeemed," not a silent success
- [ ] Admin → Users: changing a tier/admin flag and hitting Save persists on reload
- [ ] Admin → CRM shows leads from both the landing page and in-app forms
- [ ] Admin → Overview accurately reflects real env var / database state (test by removing an env var)

## What's live vs. what's next
**Live now**: full accounts, real server-side licensing and tier enforcement, all
five campaign modules (platform posts, viral hooks, CTAs, video hooks, email promo)
across four platforms, admin keygen, admin user management, CRM with Kit sync and
resync, TXT/CSV/PDF export.
**Not yet wired**: payment checkout (PayPal links aren't on the pricing buttons yet
— they currently link to `/register.html`), password reset/forgot-password flow,
email verification on signup.
