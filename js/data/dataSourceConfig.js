/**
 * dataSourceConfig.js — chooses whether the public site reads from Supabase
 * (live DB — local Docker or cloud, whichever supabaseClient.js resolves to)
 * or falls back to the original static leagues/**\/*.csv|json files.
 *
 * `?datasource=files` / `?datasource=supabase` in the URL force a specific
 * choice — useful for deliberately viewing the frozen snapshot, or for a dev
 * machine with no Docker/no internet (use `?datasource=files` explicitly).
 * Every other case, including localhost, defaults to 'supabase' immediately,
 * with no network round trip and no async wait of any kind.
 *
 * Pre-Phase-3 history: this used to auto-probe Supabase reachability on
 * localhost only (a top-level `await` blocking every module that imports
 * this, up to 2.5s worst case) and silently fall back to 'files' on failure.
 * Removed per docs/data-architecture/01-architecture.md §A4 and
 * docs/data-architecture/02-query-standards.md rule 7 (no network I/O in a
 * top-level await anywhere in js/data/**) — a Docker-less dev session now
 * asks for `?datasource=files` explicitly instead of paying that cost on
 * every other session, and getDataSource() is a synchronous, instant call.
 *
 * Scope: read path only (js/data/store.js). Admin (js/admin/**) always
 * targets Supabase directly regardless of this — 'files' mode has no writer,
 * so mixing it into Admin would silently reintroduce the exact stale-data
 * problem the Supabase migration eliminated.
 */

const forced = new URLSearchParams(location.search).get('datasource');
const _source = forced === 'files' ? 'files' : 'supabase';

export function getDataSource() {
    return _source;
}
