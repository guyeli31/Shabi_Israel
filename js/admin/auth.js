/**
 * auth.js — Admin authentication via Supabase Auth (email + password).
 *
 * Replaces the old SHA-256 password hash + GitHub PAT (real write authority
 * used to come from the PAT; now Supabase RLS is the real gate — any
 * `authenticated` Supabase user has full admin write access, per the flat
 * "any authenticated = admin" model this project chose. See
 * C:\Users\User\.claude\plans\shiny-cooking-frog.md section E for the full
 * rationale, including local-vs-cloud Auth environment behavior.
 *
 * isLoggedIn()/getUsername() stay SYNCHRONOUS (same contract every call site
 * already depends on) by keeping a warm in-memory session cache, populated
 * once at module load via getSession() and kept current via onAuthStateChange.
 * There is a brief window on cold page load, before the initial getSession()
 * resolves, where isLoggedIn() may read false even if a session exists —
 * accepted tradeoff to avoid refactoring every synchronous call site to async.
 */

import { supabase } from '../data/supabaseClient.js';

let _session = null;

// Top-level await: any module that imports auth.js (directly or transitively)
// waits for this to resolve before running, so isLoggedIn()/getUsername()
// are correct from the very first synchronous call — no cold-load race.
{
    const { data } = await supabase.auth.getSession();
    _session = data.session;
}

supabase.auth.onAuthStateChange((_event, session) => {
    _session = session;
});

/**
 * Attempt login. Returns true on success.
 */
export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return false;
    _session = data.session;
    return true;
}

/**
 * Log out. Clears the local session cache immediately (synchronous, so
 * dependent UI updates right away) and fires the server-side sign-out in
 * the background.
 */
export function logout() {
    _session = null;
    supabase.auth.signOut();
}

/**
 * Get the currently logged-in admin's email.
 */
export function getUsername() {
    return _session?.user?.email || '';
}

/**
 * Check if admin is currently logged in.
 */
export function isLoggedIn() {
    return _session !== null;
}
