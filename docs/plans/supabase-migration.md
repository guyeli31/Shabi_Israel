# Migration Plan: Shabi Israel → Supabase

## Context

The site is currently fully static — CSV/JSON data files served from GitHub Pages, admin publishes via GitHub API. We're transitioning to Supabase (PostgreSQL) so the Admin can update data through a web UI without touching Git. The browser still does all computation (Heavy Client). GitHub Pages stays as the hosting layer, synced from DB.

**Auth method**: Email + password (configurable admin account, e.g. guyeli31@gmail.com) via Supabase Auth.

### Core architecture principle (decided 2026-06-07)

**The admin browser talks ONLY to the server (Supabase). It never holds a GitHub PAT.**
The GitHub token lives server-side as an Edge Function secret; the Edge Function is the only thing that commits to GitHub. Consequences:
- No GitHub repo/PAT configuration in the client.
- The **Settings tab is removed entirely** — there is nothing left for it to configure.
- Settings removal happens at **cutover (Phase 7)**, *after* the Supabase write path replaces the current PAT-based Publish. Until then, the existing direct-to-GitHub Publish keeps working unchanged.

---

## Phase 0: Supabase Project Setup (Guy — step-by-step guide)

### Step 0.1: Create Supabase Account & Project
1. Go to https://supabase.com → Sign up with GitHub or Google
2. Click "New Project"
3. Project name: `shabi-israel`
4. Database password: choose a strong password (save it — needed for DBeaver)
5. Region: choose closest (e.g., `eu-central-1` Frankfurt)
6. Plan: Free tier is fine
7. Wait ~2 minutes for project creation

### Step 0.2: Collect Keys
1. Go to Project Settings → API
2. Copy and save locally (never commit these):
   - `Project URL` → this is `SUPABASE_URL`
   - `anon public` key → this is `SUPABASE_ANON_KEY` (safe for browser)
   - `service_role` key → this is `SUPABASE_SERVICE_ROLE_KEY` (**server-only, never in client code**)

### Step 0.3: Create Admin User
1. Go to Authentication → Users
2. Click "Add User" → "Create New User"
3. Email: `guyeli31@gmail.com`
4. Password: choose a strong password (this is the admin login for the site)
5. Check "Auto Confirm User"

### Step 0.4: Connect DBeaver (optional, for DB management)
1. Open DBeaver → New Connection → PostgreSQL
2. Go to Supabase: Project Settings → Database → Connection Info
3. In DBeaver:
   - Host: `db.<project-ref>.supabase.co`
   - Port: `5432`
   - Database: `postgres`
   - User: `postgres`
   - Password: the database password from Step 0.1

### Step 0.5: Create Schema
Run the full SQL schema (Claude will provide as a `.sql` file) via:
- Option A: Supabase Dashboard → SQL Editor → paste and run
- Option B: DBeaver → SQL Editor → paste and run

The SQL includes:
- 8 tables: `landing_settings`, `leagues`, `matches`, `manual_overrides`, `match_history`, `players_metadata`, `audit_log`, `league_snapshots`
- Auto `updated_at` triggers on all data tables
- Audit trigger: automatic logging of every INSERT/UPDATE/DELETE
- RLS policies: visitors=read-only, admin=full access

### Step 0.6: Verify Setup
1. In Supabase Dashboard → Table Editor → confirm all 8 tables exist
2. In Authentication → Users → confirm admin user exists
3. Give Claude the `SUPABASE_URL` and `SUPABASE_ANON_KEY` (safe to share)
4. **Keep `SERVICE_ROLE_KEY` private** — only for local migration script and Edge Functions

---

## Local Development Environment (cross-cutting — set up alongside Phase 0)

**Goal:** keep the current `http://localhost:8090/` preview habit, while developing against data *without ever risking production*.

**Code stays local; only the data source changes.** `http-server` still serves the HTML/CSS/JS from disk. The page fetches data from whichever Supabase the client config points at.

### Local Supabase via CLI (recommended dev setup)
- Install the **Supabase CLI** and run `supabase start` — spins up the full stack in Docker (Postgres + Auth + API + Studio) on localhost.
- Seed it with production data: `supabase db dump` from the cloud project, or re-run `tools/migrate-to-supabase.mjs` pointed at the local instance.
- Develop, edit, import, break and fix freely — including admin **write** operations — with zero impact on the live DB.

### Environment toggle in `supabaseClient.js`
A single config switch chooses the backend:

| Context | Supabase target |
|---------|-----------------|
| Local dev (`localhost`) | Local Supabase (Docker) — safe sandbox |
| Production (live site) | Cloud Supabase — real data |

Implemented via an env/config flag (e.g. detect `localhost` hostname, or a `?dev=1` / build-time var). Swapping one line changes which DB the local page talks to.

### Quick read-only alternative
For pure UI/read-path tweaks, point `localhost` straight at the **cloud anon key** — no Docker needed. ⚠️ Do **not** test admin writes this way; they hit production data.

---

## Phase 1: DB Seed (Claude writes, Guy runs locally)

**One-time migration script**: `tools/migrate-to-supabase.mjs`
- Reads all existing `landing_settings.json`, `league_params.json`, `leaguedata.csv` files
- Inserts into Supabase using `service_role` key (local-only, never committed)
- Idempotent (uses UPSERT)
- Run with: `node tools/migrate-to-supabase.mjs`

**Site continues working unchanged — still reads from static files.**

---

## Phase 2: Read Path — Visitors read from Supabase

### New files:
- `js/data/supabaseClient.js` — Supabase client singleton (anon key, safe to expose)
- `js/data/supabaseLoader.js` — Drop-in replacement for `leagueLoader.js`, same exported function signatures
- `js/utils/sanitize.js` — `escapeHtml()` for XSS prevention on DB-sourced text

### Changes:
- All render modules (`landingPage.js`, `leaguePage.js`, `playerPage.js`, `dashboardPage.js`, `playerGeneralPage.js`, `crossLeague.js`) update imports from `leagueLoader.js` → `supabaseLoader.js`
- Add Supabase JS SDK via ESM CDN import (`https://esm.sh/@supabase/supabase-js@2`)
- Every `innerHTML` with player names/text → wrap with `escapeHtml()`

### Unchanged:
- `stats.js`, `rankings.js`, `championshipPredictor.js`, `colorScale.js` — receive same match objects, no changes needed

---

## Phase 3: Admin Auth — Supabase Auth replaces SHA-256 + PAT

### Rewrite `js/admin/auth.js`:
- `login(email, password)` → `supabase.auth.signInWithPassword()`
- `logout()` → `supabase.auth.signOut()`
- `isLoggedIn()` → `supabase.auth.getSession()`
- Remove GitHub PAT requirement from login flow
- Remove SHA-256 hash of "admin123"

### Update `admin.html` login form:
- Email + password fields (instead of username + password + PAT)

---

## Phase 4: Admin Write Path — Writes go to Supabase

### New file: `js/admin/supabaseAdmin.js`
Exports: `upsertLeague()`, `deleteLeague()`, `upsertMatches()`, `upsertOverride()`, `deleteOverride()`, `upsertPlayerMetadata()`, `updateLandingSettings()`, `bulkImportCSV()`, `createSnapshot()`, `triggerGitHubSync()`

### Changes:
- `stagingStore.js` → `publishAll()` calls Supabase instead of GitHub API
- `leagueManager.js` → create/edit/delete league use `supabaseAdmin`
- `csvEditor.js` → match edits use `supabaseAdmin`
- `excelImporter.js` → CSV/Excel upload: parse in browser → `bulkImportCSV()` → Supabase
- `playerManager.js` → metadata writes use `supabaseAdmin`

### CSV upload flow:
```
Admin uploads CSV → browser parses (reuse csvParser.js) → supabaseAdmin.bulkImportCSV()
  → createSnapshot() (safety) → DELETE old matches → INSERT parsed rows → audit auto-logged
```

---

## Phase 5: GitHub Sync — Edge Function (Supabase → GitHub)

### New: Supabase Edge Function `sync-to-github`
- Triggered by admin after publish: `supabase.functions.invoke('sync-to-github', { body: { league_id } })`
- Verifies JWT (rejects anon callers)
- Reads DB with `service_role` key (server-only)
- Reconstructs file content (CSV with round headers, JSON)
- PUTs files to GitHub via Contents API using `GITHUB_PAT` (stored as Edge Function secret)
- Only writes to `leagues/` and `assets/` paths — **never touches source code**

### Secrets (Edge Function environment only):
| Secret | Purpose | Exposed to browser? |
|--------|---------|---------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Full DB access in Edge Function | **No** |
| `GITHUB_PAT` | Push files to GitHub repo | **No** |

### Client-side keys:
| Key | Purpose | Safe? |
|-----|---------|-------|
| `SUPABASE_ANON_KEY` | Read-only queries (RLS enforced) | **Yes** |

---

## Phase 6: Audit UI + Rollback

### Admin panel additions:
- **Audit Trail tab** — read-only table from `audit_log` (who, what, when, old/new values)
- **Snapshots tab** — list of `league_snapshots` with "Restore" button

### Rollback levels:
1. **Row-level**: revert single change from `audit_log.old_value`
2. **League-level**: restore full state from `league_snapshots` (auto-created before bulk imports)
3. **Platform-level**: Supabase daily backups (7-day retention on free tier)
4. **Git fallback**: GitHub repo always has the last-synced version of all data files

---

## Phase 7: Cleanup + Hardening

- Remove old `githubApi.js` references
- **Delete the Settings tab entirely** (renderSettings + the `#settings` nav items in `adminPage.js` and `adminSidebar.js`) — the client no longer configures repo/PAT
- Audit all `innerHTML` for unescaped DB text
- Update `CLAUDE.md` with new architecture
- Delete migration script from repo

---

## Database Schema Summary

| Table | Purpose | Anon access |
|-------|---------|-------------|
| `landing_settings` | Site title, subtitle, logo | SELECT |
| `leagues` | League config (type, prizes, flags, etc.) | SELECT (hidden=false) |
| `matches` | All match results per league | SELECT |
| `manual_overrides` | Admin corrections to matches | SELECT |
| `match_history` | Timeline of when matches were recorded | SELECT |
| `players_metadata` | Player profiles, photos, titles | SELECT |
| `audit_log` | Every DB change logged automatically | **Admin only** |
| `league_snapshots` | Full league state for rollback | **Admin only** |

---

## Key Files to Modify

| File | Change |
|------|--------|
| `js/data/leagueLoader.js` | Replace with `supabaseLoader.js` (same API) |
| `js/admin/auth.js` | Rewrite: SHA-256+PAT → Supabase Auth |
| `js/admin/stagingStore.js` | `publishAll()` → Supabase + Edge Function |
| `js/admin/githubApi.js` | Remove (replaced by Edge Function) |
| `js/admin/leagueManager.js` | Write ops → `supabaseAdmin.js` |
| `js/admin/csvEditor.js` | Write ops → `supabaseAdmin.js` |
| `js/admin/playerManager.js` | Write ops → `supabaseAdmin.js` |
| All render modules | Add `escapeHtml()` to DB-sourced text in innerHTML |
| All HTML pages | Add Supabase SDK import |

## New Files

| File | Purpose |
|------|--------|
| `js/data/supabaseClient.js` | Supabase client + auth helpers |
| `js/data/supabaseLoader.js` | Data loading (replaces leagueLoader) |
| `js/admin/supabaseAdmin.js` | Admin write operations |
| `js/utils/sanitize.js` | XSS prevention utility |
| `tools/migrate-to-supabase.mjs` | One-time seed script (local only) |
| `supabase/functions/sync-to-github/` | Edge Function for GitHub sync |

---

## Verification

After each phase (point the local page at **local Supabase**, not production — see "Local Development Environment"):
1. `npx http-server -p 8090 --cors -c-1` — serve locally
2. Open all pages: index, league, player, dashboard, player_general
3. Verify data loads correctly and stats compute
4. Admin: login, edit, publish, verify DB and GitHub updated
5. Anon: verify write attempts are rejected (browser console: Supabase RLS error)
6. Audit: check `audit_log` table in DBeaver after each admin action
