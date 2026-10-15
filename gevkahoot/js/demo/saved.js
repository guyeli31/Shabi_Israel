/**
 * saved.js — a quiz from the database, made playable by the demo engine.
 *
 * The same quiz the host runs live can be played by one person alone against
 * the demo's bots (index.html?demo&quiz=<id>), once the host has opened it for
 * that in the editor (gk_quizzes.demo_public). gk_demo_get() hands over its
 * items as gk_items rows; the demo's items ARE that row shape, so all that is
 * left here is what a live run gets from the host or from _gk_publish:
 *
 *   seconds  how long an interlude stays up — the host's "next" in a live run,
 *            a fixed pause here (longer for a video, which wants watching)
 *   circle   the puzzle's lifting detail, from circle_x/y/r/speed
 *   ball     the action round's ball, from circle_x/y/r
 */
import { demoList, demoGet } from '../data/api.js';
import { demoItem } from './demoQuiz.js';

const INTERLUDE_S = 8, VIDEO_S = 15;

const circleOf = (r, withSpeed) => (r.circle_r === null || r.circle_r === undefined ? null
    : { x: r.circle_x, y: r.circle_y, r: r.circle_r, ...(withSpeed ? { speed: r.circle_speed } : {}) });

function adapt(row) {
    const it = demoItem({ ...row });
    if (it.kind === 'interlude') it.seconds = row.video ? VIDEO_S : INTERLUDE_S;
    if (it.kind === 'puzzle') it.circle = circleOf(row, true);
    if (it.kind === 'action') it.ball = circleOf(row, false);
    if (row.explain) it.explain = { ...demoItem({ ...row.explain }), seconds: row.explain.video ? VIDEO_S : INTERLUDE_S };
    return it;
}

/** The quizzes the host opened for solo play: [{ id, title }]. */
export const listSavedQuizzes = () => demoList().catch(() => []);

/** { quiz, items } for createDemo(), or throws ('no_demo', 'live'). */
export async function loadSavedQuiz(id) {
    const { quiz, items } = await demoGet(id);
    return { quiz, items: items.map(adapt) };
}
