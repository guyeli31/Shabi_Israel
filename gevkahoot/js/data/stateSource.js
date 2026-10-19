/**
 * stateSource.js — where a screen gets "what is on air right now".
 *
 * Both the phone and the projected screen are pure functions of one state
 * object; this module is the only thing that knows where that object comes
 * from. There are two sources:
 *
 *   live     the two public rows (gk_public_state, gk_public_live), pushed by
 *            Supabase Realtime and re-read by a poll.
 *   preview  postMessage from the editor, which frames these same pages and
 *            feeds them invented state — so what the editor shows IS the real
 *            screen, with no database involved.
 *
 * Realtime is the fast path, not the only path. A phone that sleeps, changes
 * network or sits behind a proxy that drops websockets must still follow the
 * quiz, so the poll never stops: slow while the channel is healthy, fast when
 * it is not, and immediate when the tab comes back to the foreground.
 */
import { supabase } from './api.js';
import { hasUrlFlag } from '../../../shabi-israel/js/utils/queryString.js';

export const isPreview = hasUrlFlag('preview');

const EMPTY = { status: 'idle', phase: 'idle', rev: -1, data: {}, live: { answered: 0, players: 0, names: [] } };

export function createStateSource(onChange) {
    let state = { ...EMPTY };
    const emit = (extra) => onChange(state, extra);

    if (isPreview) {
        window.addEventListener('message', (event) => {
            // Same-origin only: the editor is the one legitimate sender.
            if (event.origin !== location.origin) return;
            const msg = event.data;
            if (!msg || msg.type !== 'gk-preview' || !msg.state) return;
            state = { ...EMPTY, ...msg.state, live: { ...EMPTY.live, ...(msg.state.live || {}) } };
            emit({ me: msg.me || null });
        });
        window.parent?.postMessage({ type: 'gk-preview-ready' }, location.origin);
        return { refresh: () => {}, get: () => state };
    }

    let liveSeq = -1;
    const applyState = (row) => {
        if (!row || row.rev <= state.rev) return false;
        // session_id: which run this is — only the player analytics reads it
        // (js/data/analytics.js), to tie a visit to its run.
        state = { ...state, status: row.status, phase: row.phase, rev: row.rev, session_id: row.session_id || null, data: row.data || {} };
        return true;
    };
    const applyLive = (row) => {
        if (!row || row.seq <= liveSeq) return false;
        liveSeq = row.seq;
        state = { ...state, live: { answered: row.answered, players: row.players, names: row.names || [] } };
        return true;
    };

    let connected = false;
    async function refresh() {
        const [a, b] = await Promise.all([
            supabase.from('gk_public_state').select('*').eq('id', 1).maybeSingle(),
            supabase.from('gk_public_live').select('*').eq('id', 1).maybeSingle(),
        ]);
        const first = state.rev === -1 && !a.error;
        const changedState = applyState(a.data);
        const changedLive = applyLive(b.data);
        if (first || changedState || changedLive) emit();
    }

    supabase.channel('gevkahoot-public')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gk_public_state' },
            (payload) => { if (applyState(payload.new)) emit(); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gk_public_live' },
            (payload) => { if (applyLive(payload.new)) emit(); })
        .subscribe((status) => {
            const now = status === 'SUBSCRIBED';
            // A (re)connect may have missed events — catch up at once.
            if (now && !connected) refresh();
            connected = now;
        });

    let elapsed = 0;
    setInterval(() => {
        elapsed += 1;
        if (document.hidden) return;
        if (!connected ? elapsed % 2 === 0 : elapsed % 8 === 0) refresh();
    }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('online', refresh);

    refresh();
    return { refresh, get: () => state };
}
