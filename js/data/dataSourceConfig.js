/**
 * dataSourceConfig.js — decides, automatically, whether the public site reads
 * from Supabase (live DB — local Docker or cloud, whichever supabaseClient.js
 * resolves to) or falls back to the original static leagues/**\/*.csv|json
 * files, with NO manual switch needed: on page load, this probes whether
 * Supabase is actually reachable (short timeout) and picks accordingly.
 *
 * This means `tools/START_SITE.bat` is the only launcher needed — a machine with
 * no Docker/no internet automatically gets the local-files experience, one
 * with Supabase reachable gets the live DB, with zero user action either way.
 *
 * `?datasource=files` / `?datasource=supabase` in the URL still force a
 * specific choice (skips the probe) — useful for deliberately testing the
 * fallback path, or viewing the frozen snapshot even when Supabase IS reachable.
 *
 * The probe only runs on localhost/127.0.0.1 (a dev machine that may have no
 * Docker/no internet). On any other host — the real deployed site — Supabase
 * is assumed reachable and selected immediately with no round trip: post
 * cutover, `leagues/**` is a frozen historical snapshot, so falling back to
 * it on production would silently serve stale data instead of a clear error.
 *
 * Scope: read path only (js/data/dataSourceLoader.js / dataSourceMeta.js).
 * Admin (js/admin/**) always targets Supabase directly regardless of this —
 * 'files' mode has no writer, so mixing it into Admin would silently
 * reintroduce the exact stale-data problem Phase 2 eliminated.
 */

import { resolvedUrl, resolvedAnonKey } from './supabaseClient.js';

const PROBE_TIMEOUT_MS = 2500;
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

async function probeSupabaseReachable() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        // Any response (even a 4xx) means the server is reachable — only a
        // network-level failure (timeout, connection refused, DNS) should
        // trigger the local-files fallback.
        await fetch(`${resolvedUrl}/rest/v1/landing_settings?select=id&limit=1`, {
            headers: { apikey: resolvedAnonKey },
            signal: controller.signal,
        });
        clearTimeout(timer);
        return true;
    } catch {
        return false;
    }
}

const forced = new URLSearchParams(location.search).get('datasource');

// Top-level await: any module importing this (directly or transitively via
// dataSourceLoader.js/dataSourceMeta.js) waits for the probe to resolve
// before running, so getDataSource() is correct from its very first call —
// no async plumbing needed at every call site, and no race on cold load.
let _source;
if (forced === 'files' || forced === 'supabase') {
    _source = forced;
} else if (!isLocal) {
    _source = 'supabase';
} else {
    _source = (await probeSupabaseReachable()) ? 'supabase' : 'files';
}

export function getDataSource() {
    return _source;
}
