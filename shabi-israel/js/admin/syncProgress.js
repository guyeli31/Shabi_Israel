/**
 * syncProgress.js — stage timers + a run-time estimate for the Sync page's
 * "Run Now".
 *
 * A Run Now passes through the same four observable stages every time:
 *
 *   dispatch  — the RPC reaches the site and the run is accepted.
 *   startup   — the runner boots (checkout + install) until it reports for duty.
 *   connect   — browser launch, connecting to the source site, signing in.
 *   league:ID — one export pass per selected league (they run one after another).
 *
 * The admin can't see any of that from the log alone — a 60s silent gap while a
 * runner installs looks identical to a hang. So each stage shows how long it has
 * been running against how long it usually takes.
 *
 * Estimates are seeded with the baselines below and then CALIBRATED against the
 * admin's own runs: every completed stage records its real duration to
 * localStorage, and the estimate becomes the median of the last few samples. So
 * the numbers get truer the more the page is used, and they're honest about being
 * approximate ("~") rather than promising a deadline.
 *
 * Fast mode (Run Now) has no anti-bot delays — those only apply to scheduled
 * full-mode plans, whose runtime is deliberately randomised and NOT estimated here.
 */

const STORE_KEY = 'bgsync-stage-timings';
const MAX_SAMPLES = 5;

/** Baseline seconds per stage, used until the admin's own runs calibrate them. */
const DEFAULTS = { dispatch: 6, startup: 55, connect: 25, league: 35 };

// ── calibration store ──────────────────────────────────────────────────────
function readStore() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        return (raw && typeof raw === 'object') ? raw : {};
    } catch { return {}; }
}

function writeStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* quota / private mode — estimates just stay at defaults */ }
}

function median(nums) {
    const s = [...nums].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Record one stage's real duration (seconds), keeping the last MAX_SAMPLES. */
function recordSample(key, seconds) {
    if (!(seconds > 0) || seconds > 3600) return; // ignore nonsense / abandoned tabs
    const store = readStore();
    const samples = Array.isArray(store[key]) ? store[key] : [];
    samples.push(Math.round(seconds));
    store[key] = samples.slice(-MAX_SAMPLES);
    writeStore(store);
}

/**
 * Expected seconds for a stage. A per-league key falls back to the generic
 * "league" history (a league we've never synced still gets a sane number), and
 * that falls back to the baseline.
 */
export function expectedSeconds(key) {
    const store = readStore();
    const isLeague = key.startsWith('league:');
    const samples = (Array.isArray(store[key]) && store[key].length)
        ? store[key]
        : (isLeague && Array.isArray(store.league) && store.league.length ? store.league : null);
    if (samples) return Math.round(median(samples));
    return DEFAULTS[isLeague ? 'league' : key];
}

/** Total expected seconds for a run over these league ids ("if all goes smoothly"). */
export function estimateRunSeconds(leagueIds) {
    const base = expectedSeconds('dispatch') + expectedSeconds('startup') + expectedSeconds('connect');
    return leagueIds.reduce((sum, id) => sum + expectedSeconds(`league:${id}`), base);
}

/** Seconds → "1:05" / "0:42" (m:ss — compact and unambiguous in a timer). */
export function fmtDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── the live stage panel ───────────────────────────────────────────────────
/**
 * Build a stage tracker bound to an element. Stages tick once a second, showing
 * "elapsed / ~expected" plus a progress bar; a stage that overruns its estimate
 * keeps counting and says so instead of pretending to be stuck at 100%.
 *
 * @param {HTMLElement} el       container to render into
 * @param {Array<{id:string,title:string}>} leagues  selected leagues, in run order
 */
export function createStageTracker(el, leagues) {
    const stages = [
        { key: 'dispatch', label: 'Sending the request' },
        { key: 'startup', label: 'Starting the runner' },
        { key: 'connect', label: 'Connecting & signing in' },
        ...leagues.map((l) => ({ key: `league:${l.id}`, label: l.title })),
    ].map((s) => ({
        ...s,
        exp: expectedSeconds(s.key),
        state: 'pending', // pending | active | done | failed
        startedAt: 0,
        elapsed: 0,
    }));

    const byKey = new Map(stages.map((s) => [s.key, s]));
    const refs = new Map();
    let timer = null;

    el.innerHTML = `
        <div class="sync-stages-head">
            <span class="sync-stages-title">Progress</span>
            <span class="sync-stages-remaining" data-role="remaining"></span>
        </div>
        <ol class="sync-stages">
            ${stages.map((s) => `
                <li class="sync-stage" data-key="${escAttr(s.key)}">
                    <span class="sync-stage-icon" aria-hidden="true"></span>
                    <span class="sync-stage-name">${escHtml(s.label)}</span>
                    <span class="sync-stage-time">~${fmtDuration(s.exp)}</span>
                    <span class="sync-stage-bar"><i></i></span>
                </li>`).join('')}
        </ol>`;

    el.querySelectorAll('.sync-stage').forEach((li) => {
        refs.set(li.dataset.key, {
            li,
            time: li.querySelector('.sync-stage-time'),
            bar: li.querySelector('.sync-stage-bar i'),
        });
    });
    const remainingEl = el.querySelector('[data-role="remaining"]');

    function paint(stage) {
        const r = refs.get(stage.key);
        if (!r) return;
        r.li.className = `sync-stage is-${stage.state}`;
        const exp = stage.exp;
        if (stage.state === 'pending') {
            r.time.textContent = `~${fmtDuration(exp)}`;
            r.bar.style.width = '0%';
            return;
        }
        const el0 = stage.elapsed;
        // Done/failed stages freeze on their real duration; active ones keep ticking.
        r.time.textContent = (stage.state === 'done' || stage.state === 'failed')
            ? fmtDuration(el0)
            : `${fmtDuration(el0)} / ~${fmtDuration(exp)}${el0 > exp + 5 ? ' · longer than usual' : ''}`;
        // A finished stage reads as full; a failed one stops where it stopped.
        r.bar.style.width = stage.state === 'done'
            ? '100%'
            : `${Math.min(100, exp > 0 ? (el0 / exp) * 100 : 100)}%`;
    }

    function paintRemaining() {
        if (!remainingEl) return;
        const anyActive = stages.some((s) => s.state === 'active');
        if (!anyActive && stages.every((s) => s.state !== 'pending')) { remainingEl.textContent = ''; return; }
        let left = 0;
        for (const s of stages) {
            if (s.state === 'pending') left += s.exp;
            else if (s.state === 'active') left += Math.max(0, s.exp - s.elapsed);
        }
        remainingEl.textContent = `≈ ${fmtDuration(left)} left`;
    }

    function tick() {
        const now = Date.now();
        let changed = false;
        for (const s of stages) {
            if (s.state !== 'active') continue;
            s.elapsed = (now - s.startedAt) / 1000;
            paint(s);
            changed = true;
        }
        if (changed) paintRemaining();
    }

    stages.forEach(paint);
    paintRemaining();

    return {
        el,

        /** Start a stage. Idempotent — callers fire it on every incoming log line,
         *  so only a still-pending stage actually starts (never a restart). */
        begin(key) {
            const s = byKey.get(key);
            if (!s || s.state !== 'pending') return;
            s.state = 'active';
            s.startedAt = Date.now();
            s.elapsed = 0;
            paint(s);
            paintRemaining();
            if (!timer) timer = setInterval(tick, 1000);
        },

        /** Mark a stage finished — its real duration calibrates future estimates. */
        complete(key) {
            const s = byKey.get(key);
            if (!s || s.state !== 'active') return;
            s.elapsed = (Date.now() - s.startedAt) / 1000;
            s.state = 'done';
            recordSample(key, s.elapsed);
            paint(s);
            paintRemaining();
        },

        /** Mark a stage failed — no sample recorded (a failure isn't a duration). */
        fail(key) {
            const s = byKey.get(key);
            if (!s || s.state !== 'active') return;
            s.elapsed = (Date.now() - s.startedAt) / 1000;
            s.state = 'failed';
            paint(s);
            paintRemaining();
        },

        /** Is this stage still waiting to start? */
        isPending(key) {
            const s = byKey.get(key);
            return !!s && s.state === 'pending';
        },

        /** Stop the clock; fail whatever is still running. */
        stop() {
            if (timer) { clearInterval(timer); timer = null; }
            for (const s of stages) {
                if (s.state === 'active') { s.elapsed = (Date.now() - s.startedAt) / 1000; s.state = 'failed'; paint(s); }
            }
            paintRemaining();
        },

        /** Stop the clock, leaving completed stages as they are. */
        done() {
            if (timer) { clearInterval(timer); timer = null; }
            paintRemaining();
        },
    };
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : str;
    return d.innerHTML;
}
function escAttr(str) {
    return escHtml(str).replace(/"/g, '&quot;');
}
