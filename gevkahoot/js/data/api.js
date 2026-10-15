/**
 * api.js — every call GevKahoot makes to the backend, in one place.
 *
 * The Supabase client is the main site's singleton: same project, same
 * local-vs-cloud switch, and the same stored admin session, so an admin logged
 * into Shabi Israel is already logged in here.
 */
import { supabase } from '../../../shabi-israel/js/data/supabaseClient.js';
import { deviceToken } from './device.js';

export { supabase };

/** The functions raise short machine codes ('name_taken', 'closed', …) as the
 *  exception message; surface that code so callers can branch on it. */
async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
        const err = new Error(error.message || 'rpc_failed');
        err.code = /^[a-z_ ]+$/.test(error.message || '') ? error.message : 'rpc_failed';
        throw err;
    }
    return data;
}

// ---- player ---------------------------------------------------------------
export const serverTime = () => rpc('gk_time');
export const join = (name) => rpc('gk_join', { p_name: name, p_token: deviceToken() });
export const requestRelink = (name) => rpc('gk_request_relink', { p_name: name, p_token: deviceToken() });
export const me = () => rpc('gk_me', { p_token: deviceToken() });
export const answer = (itemId, option) =>
    rpc('gk_answer', { p_token: deviceToken(), p_item: itemId, p_option: option });

// ---- host -----------------------------------------------------------------
export const admin = {
    isAdmin: () => rpc('is_admin'),
    state: () => rpc('gk_admin_state'),
    open: (quizId) => rpc('gk_admin_open', { p_quiz: quizId }),
    next: () => rpc('gk_admin_next'),
    goto: (index) => rpc('gk_admin_goto', { p_index: index }),
    reveal: () => rpc('gk_admin_reveal'),
    show: (view) => rpc('gk_admin_show', { p_view: view }),
    finish: () => rpc('gk_admin_finish'),
    close: () => rpc('gk_admin_close'),
    lock: (locked) => rpc('gk_admin_lock', { p_locked: locked }),
    kick: (playerId) => rpc('gk_admin_kick', { p_player: playerId }),
    relink: (requestId, approve) => rpc('gk_admin_relink', { p_request: requestId, p_approve: approve }),
    rescore: (itemId) => rpc('gk_admin_rescore', { p_item: itemId }),
    cancel: (itemId, cancel) => rpc('gk_admin_cancel', { p_item: itemId, p_cancel: cancel }),
    refresh: () => rpc('gk_admin_refresh'),
};

// ---- authoring (plain table access; RLS admits admins only) ---------------
async function unwrap(query) {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
}

export const quizzes = {
    list: () => unwrap(supabase.from('gk_quizzes').select('*').order('created_at')),
    create: (title) => unwrap(supabase.from('gk_quizzes').insert({ title }).select().single()),
    update: (id, patch) => unwrap(supabase.from('gk_quizzes').update(patch).eq('id', id).select().single()),
    remove: (id) => unwrap(supabase.from('gk_quizzes').delete().eq('id', id)),
};

export const items = {
    list: (quizId) => unwrap(supabase.from('gk_items').select('*').eq('quiz_id', quizId)
        .order('position').order('created_at').order('id')),
    create: (row) => unwrap(supabase.from('gk_items').insert(row).select().single()),
    update: (id, patch) => unwrap(supabase.from('gk_items').update(patch).eq('id', id).select().single()),
    remove: (id) => unwrap(supabase.from('gk_items').delete().eq('id', id)),
};

export const archive = {
    list: () => unwrap(supabase.from('gk_sessions')
        .select('id, quiz_title, finished_at, result').eq('status', 'finished')
        .order('finished_at', { ascending: false }).limit(50)),
};

// ---- auth -----------------------------------------------------------------
export async function currentSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
}
export async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return !error;
}
export const signOut = () => supabase.auth.signOut();
