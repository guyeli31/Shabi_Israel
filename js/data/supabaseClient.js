/**
 * supabaseClient.js — Supabase client singleton (anon key, safe to expose).
 *
 * Environment toggle: on localhost/127.0.0.1 this points at a local Supabase
 * instance (Docker via `supabase start`) instead of the cloud project. This
 * gates BOTH data reads AND Auth identity — logging into Admin from localhost
 * authenticates against the local `auth.users` table, a completely separate
 * user set from the cloud project's Auth. Create a local admin user via the
 * local Supabase Studio (http://127.0.0.1:54323) before testing Admin writes
 * locally. See docs/plans/supabase-migration.md's "Local Development
 * Environment" section for the full rationale.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    LOCAL_SUPABASE_URL,
    LOCAL_SUPABASE_ANON_KEY,
} from './supabaseConfig.js';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

// Exported (not just used internally) so dataSourceConfig.js can probe
// reachability against the exact same endpoint this client actually targets.
export const resolvedUrl = isLocal ? LOCAL_SUPABASE_URL : SUPABASE_URL;
export const resolvedAnonKey = isLocal ? LOCAL_SUPABASE_ANON_KEY : SUPABASE_ANON_KEY;

export const supabase = createClient(resolvedUrl, resolvedAnonKey);
