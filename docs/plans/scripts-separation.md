# Plan: Separate `scripts/` (BGStudio sync) into a private repo

> **How to use this file:** this is a self-contained brief. You can paste it into a
> fresh Claude Code chat (even on another machine) and start work without prior context.
> It is independent from the analytics POC plan (`docs/plans/analytics-poc.md`) — see
> "Scope boundary" below.

---

## Context

The project "Shabi Israel" (Backgammon league stats, vanilla HTML/CSS/JS, hosted on
GitHub Pages at **golan.me.uk**) contains a private-side automation script,
`scripts/sync-bgstudio.js`, that logs into BGStudio with Playwright + stealth plugin and
exports league CSV data via a scheduled/dispatched GitHub Actions workflow.

A cold sales email (proxy vendor) found the project by scanning public GitHub for
`stealth` / `puppeteer-extra` keywords in that script. The concern is that the
**automation methodology** is publicly visible — not because secrets leaked (they don't:
credentials come from env vars / GitHub Secrets, and `scripts/out/` is gitignored), but
because:

1. The anti-bot disguise logic (human-like typing, random viewports, fake side-tasks,
   BGStudio internal selectors) is readable by anyone — including the target site,
   which could fingerprint and block the automation.
2. It attracts exactly this kind of lead-gen spam.

**Constraint that rules out the simplest fix:** the site is served via GitHub Pages
with a custom domain (`CNAME` = `golan.me.uk`) on a **free** account. Making the whole
repo private would take Pages offline. So the public site must stay public; only the
sync automation moves out of view.

**Additional constraint:** the platform will keep being developed actively even while
running against a live client. The solution must let the two repos evolve independently.

**Functional dependency to account for:** the sync has a CSV-integrity check
(`getBaselinePlayedCount` in `scripts/sync-bgstudio.js:253-270`) that reads
`leagues/<folder>/leaguedata.csv` + `manual_overrides.json` to compute a post-overrides
baseline and retry export (3 attempts) if BGStudio returns a truncated export. This
makes those repo data files a **functional** dependency of the sync, not just reporting.

## Scope boundary — independent from the analytics POC

This plan is **separate and independent** from the in-house analytics POC
(`docs/plans/analytics-poc.md`). They share no code and have no ordering dependency:

- **This plan (separation)** = write-side automation moving to a new **private** repo
  (`scripts/`, the workflow). Touches CI and GitHub repo settings only.
- **Analytics POC** = read-side visitor instrumentation that **stays in the public repo**
  (`js/analytics.js`, public `*.html`, `analytics.html`). Untouched by this separation.

Only shared element: both will eventually use the **same Supabase project**, but as
independent consumers — the sync's Phase-2 baseline reads server-side tables with a
service/anon key; analytics inserts into its own `analytics_events` table. No dependency.
(The analytics plan's "isolate the insert grant to its own table" rule keeps them from
colliding.) Do **not** merge the two plans.

## Goal

Move the sync automation to a separate **private** GitHub repo so the methodology is
no longer public, while:
- keeping `golan.me.uk` (public Pages site) live and unchanged,
- preserving the CSV-integrity check (which needs the public repo's data files),
- keeping both repos independently developable.

## Approach

### 1. Create a new private repo (e.g. `shabi-sync`)
Move into it (these are the only files currently under `scripts/`, plus the workflow):
- `scripts/sync-bgstudio.js`
- `scripts/fetch-flag.py`
- `scripts/package.json` (deps: `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`; + lockfile if present)
- `.github/workflows/sync-bgstudio.yml`

### 2. Migrate the 2 GitHub Secrets
`BGSTUDIO_USER`, `BGSTUDIO_PASS` → define them in the new private repo's
Settings → Secrets (referenced at `.github/workflows/sync-bgstudio.yml:58-59`).

### 3. Add a second checkout in the workflow (the key change)
The sync reads the public repo's data (`leaguedata.csv`, `manual_overrides.json`,
`league_params.json`, `players_metadata.json`, `assets/flags/`). After separation the
runner must clone the public repo too:

```yaml
- uses: actions/checkout@v4                 # #1 private repo (the sync code)
- uses: actions/checkout@v4                 # #2 public repo (the data)
  with:
    repository: guyeli31/Shabi_Israel
    path: public-data
- run: node sync-bgstudio.js
  env:
    BGSTUDIO_USER: ${{ secrets.BGSTUDIO_USER }}
    BGSTUDIO_PASS: ${{ secrets.BGSTUDIO_PASS }}
    DATA_ROOT: ${{ github.workspace }}/public-data
```
Public repo needs **no token** for checkout (it is public). If the data repo is ever
made private (e.g. for a client), checkout #2 will need a PAT/deploy key.

### 4. Parameterize `repoRoot` in the sync script
Currently `repoRoot = resolve(dirname(...), '..')` (sync-bgstudio.js:550) assumes the
script sits inside the data repo. Change to read `process.env.DATA_ROOT` (falling back
to the old relative path for local runs). All downstream reads
(`getBaselinePlayedCount`, `buildKnownPlayers`, `findActiveLeague`, flags dir) use this
root, so it is a single-point change.

**Why this matters (degradation behavior):** `getBaselinePlayedCount` is wrapped in
`try/catch` returning `null` (sync-bgstudio.js:267-268). If checkout #2 is missing, the
baseline is silently `null` and the integrity check is **skipped** — sync still runs but
loses truncation protection. So checkout #2 is mandatory to keep the check alive.

### 5. Remove sync from the public repo
Delete `scripts/sync-bgstudio.js`, `scripts/fetch-flag.py`, `scripts/package.json`, and
`.github/workflows/sync-bgstudio.yml` from `guyeli31/Shabi_Israel`.
**Keep** `assets/flags/` (the public site renders them) and all of `leagues/`.

### 6. The one cross-repo "contract" to maintain
The only coupling is the **data file layout**: `leagues/<folder>/leaguedata.csv` and
`manual_overrides.json`. As long as that path shape is stable, both repos evolve freely.
If the public repo ever restructures those paths, update the private sync in tandem.

## Notes / out of scope
- **Git history:** the old sync code stays reachable in the public repo's commit history.
  Lead-gen tools (like the one that emailed) only scan current `HEAD`, so this is enough
  to stop them. History rewrite is a separate, more invasive step — only needed if
  guarding against a *targeted* adversary (e.g. BGStudio operator). Not included here.
- **Phase 2 (Supabase):** once the baseline is read from the DB
  (`getBaselinePlayedCount` Phase-2 branch, sync-bgstudio.js:254-256), checkout #2 and the
  whole public-data dependency disappear. This double-checkout is a Phase-1 bridge only.

## Verification
1. In the new private repo, run the workflow manually with `mode: fast`.
2. Confirm the job log shows: both checkouts succeeded; `CSV integrity baseline: N played`
   (non-null baseline proves checkout #2 + `DATA_ROOT` wiring work); `Integrity check
   passed`; CSV bytes/lines written; `leaguedata-<run_id>` artifact uploaded.
3. Confirm `golan.me.uk` still loads (public repo untouched by the site's perspective).
4. Confirm GitHub code search for the public repo no longer returns the sync script.
