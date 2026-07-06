/**
 * supabaseConfig.js — single source for Supabase project keys.
 * Shared verbatim by js/data/supabaseClient.js and js/analytics.js (analytics POC).
 * The anon/publishable key is safe to expose in the browser (RLS enforces access).
 */

export const SUPABASE_URL = 'https://oaowwbwssfsohaskrgnc.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_LiYVVTwNqMMiXVdtxukyxw_UyZQBa8G';

/** Local Supabase CLI instance (`supabase start`, run from supabase-migration/).
 *  This anon key is generated per-project-config, not a fixed universal demo
 *  value — printed by `supabase start`/`supabase status`. Not a secret (local
 *  dev only, documented by Supabase as a shared, non-production default). */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
export const LOCAL_SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
