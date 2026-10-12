/**
 * gevkalil-lib.mjs — shared plumbing for the two Gevkalil test scripts.
 *
 * Both scripts talk to the LOCAL Docker Supabase only, and in two voices:
 *
 *   anon()   the REST API with the publishable key — exactly what a player's
 *            phone can do, no more.
 *   host()   SQL piped to psql inside the database container, with the JWT
 *            claims of an allowlisted admin set for the transaction — what a
 *            logged-in host's call looks like to is_admin(), without any
 *            password ever appearing on a command line.
 *
 * The URL is hard-coded to 127.0.0.1: these scripts create and delete quizzes
 * and must be incapable of reaching production.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY } from '../shabi-israel/js/data/supabaseConfig.js';

if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(LOCAL_SUPABASE_URL)) {
    throw new Error('Refusing to run: LOCAL_SUPABASE_URL is not a local address.');
}

const HEADERS = { apikey: LOCAL_SUPABASE_ANON_KEY, Authorization: `Bearer ${LOCAL_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };

/** Call a function as anon. Resolves { ok, status, data, code } — never throws
 *  on an HTTP error, because half the assertions are that a call is refused. */
export async function rpc(name, args = {}) {
    const res = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, code: res.ok ? null : data?.message || String(res.status) };
}

/** Table access as anon. */
export async function rest(pathAndQuery, init = {}) {
    const res = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...HEADERS, Prefer: 'return=representation', ...(init.headers || {}) } });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
}

let container = null;
function dbContainer() {
    if (container) return container;
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).split(/\r?\n/);
    container = names.find((n) => n.startsWith('supabase_db_'));
    if (!container) throw new Error('Local Supabase is not running (no supabase_db_* container). Run tools\\ensure-docker-supabase.bat');
    return container;
}

/** Run SQL in the container. `as` picks the caller identity for the whole
 *  script: 'owner' (migrations-level), an admin e-mail, or a non-admin one. */
export function sql(text, { as = 'owner' } = {}) {
    const preamble = as === 'owner' ? '' :
        `set role authenticated;\nselect set_config('request.jwt.claims', '${JSON.stringify({ email: as, role: 'authenticated' })}', false);\n`;
    try {
        const out = execFileSync('docker', ['exec', '-i', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
            { input: preamble + text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { ok: true, out: out.trim() };
    } catch (err) {
        return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}`.trim() };
    }
}

export const ADMIN = 'claude-demo@example.com';
export const host = (text) => sql(text, { as: ADMIN });

export const token = () => crypto.randomBytes(16).toString('hex');

// ---- tiny assertion harness -----------------------------------------------
let failures = 0;
let passes = 0;
export function check(label, condition, detail = '') {
    if (condition) { passes += 1; console.log(`  ✓ ${label}`); }
    else { failures += 1; console.error(`  ✗ ${label}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
export function section(title) { console.log(`\n${title}`); }
export function finish(name) {
    console.log(`\n${name}: ${passes} passed, ${failures} failed`);
    process.exit(failures ? 1 : 0);
}

// ---- a throwaway quiz -----------------------------------------------------
export const TEST_QUIZ = '7e57ab1e-0000-4000-8000-000000000001';
export const Q = [1, 2, 3].map((n) => `7e57ab1e-0000-4000-8000-0000000000q${n}`.replace('q', 'a'));

/** Refuse to trample a quiz someone is really running on this database. */
export function requireIdle() {
    const live = sql(`select count(*) from public.gk_sessions where status in ('lobby','running') and quiz_id is distinct from '${TEST_QUIZ}';`);
    if (live.out !== '0') {
        console.error('A quiz is live on the local database. Close it from the host screen first — this script opens and closes its own.');
        process.exit(2);
    }
}

export function seedTestQuiz() {
    cleanup();
    const r = sql(`
        insert into public.gk_quizzes (id, title, lead_in_s) values ('${TEST_QUIZ}', 'script test quiz', 0);
        insert into public.gk_items (id, quiz_id, position, kind, title, options, correct, weight, time_limit_s) values
          ('${Q[0]}', '${TEST_QUIZ}', 1, 'question', 'q1', '["a","b","c"]', '{0,2}', 1, 20),
          ('${Q[1]}', '${TEST_QUIZ}', 2, 'question', 'q2', '["a","b"]', '{1}', 2, 20),
          ('${Q[2]}', '${TEST_QUIZ}', 3, 'question', 'q3', '["a","b","c","d","e"]', '{4}', 0, 20);`);
    if (!r.ok) throw new Error(`seed failed: ${r.out}`);
}

export function cleanup() {
    sql(`
        update public.gk_sessions set status = 'aborted' where status in ('lobby','running') and quiz_id = '${TEST_QUIZ}';
        select public._gk_publish(null) where exists (select 1 from public.gk_public_state st join public.gk_sessions g on g.id = st.session_id where g.quiz_title = 'script test quiz');
        delete from public.gk_sessions where quiz_title = 'script test quiz';
        delete from public.gk_quizzes where id = '${TEST_QUIZ}';`);
}

export async function publicState() {
    const r = await rest('gk_public_state?id=eq.1&select=*');
    return r.data?.[0] || null;
}
