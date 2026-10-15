/**
 * views.js — the results views shared by the projected screen, the phone and
 * the archive: the table, the podium, the matrix, and the confetti.
 */
import { h, fmtSeconds } from './dom.js';

// ---- table ----------------------------------------------------------------
/**
 * The table after a question, animated from the order BEFORE it.
 *
 * Each row carries `rank` and `prev` (its rank without the question just
 * played). Rows are laid out at `prev`, the browser is given one frame to
 * paint that, and then they are moved to `rank` — the CSS transition on
 * transform turns the difference into the slide. Points count up over the same
 * second.
 *
 * `size` rows are visible. A row is rendered when it is inside that window
 * either before or after, so a player dropping out of the top visibly slides
 * off the bottom instead of vanishing.
 */
export function leaderboard(rows, { size = 8, me = null, animate = true, streaks = {} } = {}) {
    const board = h('div', { class: 'gk-board' });
    board.style.setProperty('--rows', String(Math.min(size, Math.max(rows.length, 1))));
    const shown = rows.filter((r) => r.rank <= size || (animate && r.prev <= size));
    const moves = [];

    for (const row of shown) {
        const delta = row.prev - row.rank;
        const points = h('span', { class: 'gk-board-points', text: String(animate ? row.points - row.gain : row.points) });
        const rank = h('span', { class: 'gk-board-rank', text: String(animate ? row.prev : row.rank) });
        const el = h('div', { class: 'gk-board-row', dataset: me && row.name === me ? { me: '' } : {} },
            rank,
            h('span', { class: 'gk-board-name', dir: 'auto', text: row.name }),
            // a run of three or more correct answers that is still going
            streaks[row.name] >= 3 && h('span', { class: 'gk-board-fire', dir: 'ltr', title: `${streaks[row.name]} ברצף`, text: `🔥${streaks[row.name]}` }),
            row.gain > 0 && h('span', { class: 'gk-board-gain', dir: 'ltr', text: `+${row.gain}` }),
            h('span', { class: 'gk-board-move', dir: 'ltr', text: delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '' }),
            points);
        place(el, animate ? row.prev : row.rank);
        board.append(el);
        if (animate) moves.push({ el, row, rank, points, delta });
    }

    if (moves.length) {
        // Two frames: one for the browser to commit the "before" layout, one to
        // start from it. A single rAF is routinely coalesced with the insert.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            setTimeout(() => {
                for (const m of moves) {
                    place(m.el, m.row.rank);
                    m.rank.textContent = String(m.row.rank);
                    if (m.delta) m.el.dataset.move = m.delta > 0 ? 'up' : 'down';
                    countUp(m.points, m.row.points - m.row.gain, m.row.points, 1000);
                }
            }, 700);
        }));
    }
    return board;
}

function place(el, rank) {
    el.style.transform = `translateY(calc(var(--row-h) * ${rank - 1}))`;
}

function countUp(el, from, to, duration) {
    if (from === to) return;
    const start = performance.now();
    const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = String(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
        if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

// ---- ×2 / ×0 ---------------------------------------------------------------
const MULT_LABEL = { 0: 'בלי ניקוד', 2: 'שאלה כפולה' };

/** The marker shown while the room gets ready for a question that is not
 *  worth the usual points. Returns null for an ordinary (×1) question. */
export function multiplier(weight) {
    if (weight === 1 || !(weight in MULT_LABEL)) return null;
    return h('div', { class: 'gk-mult', dataset: { weight: String(weight) }, role: 'img', 'aria-label': `×${weight} — ${MULT_LABEL[weight]}` },
        h('div', { class: 'gk-mult-disc' },
            h('span', { class: 'gk-mult-x', text: '×' }),
            h('span', { class: 'gk-mult-n', text: String(weight) })),
        h('span', { class: 'gk-mult-label', text: MULT_LABEL[weight] }));
}

// ---- podium ---------------------------------------------------------------
/** Third, then second, then first — the reveal order is the CSS delay on each
 *  column; the DOM order (2, 1, 3) is the picture. */
export function podium(rows) {
    const top = [rows[1], rows[0], rows[2]];
    return h('div', { class: 'gk-podium' }, top.map((row, i) => row && h('div',
        { class: 'gk-podium-col', dataset: { place: String([2, 1, 3][i]) } },
        h('div', { class: 'gk-podium-name', dir: 'auto', text: row.name }),
        h('div', { class: 'gk-podium-points', text: `${row.points} נק׳` }),
        h('div', { class: 'gk-podium-block', text: String([2, 1, 3][i]) }))));
}

// ---- matrix ---------------------------------------------------------------
/** A cell is null (never answered) or [isCorrect, ms]. Green shows how many
 *  seconds after the question opened the answer came in. */
export function matrixCell(cell) {
    if (!cell) return h('td', { dataset: { cell: 'none' }, text: '–', title: 'לא ענה' });
    const [ok, ms, pts, dev, hits, share] = cell;
    if (hits !== null && hits !== undefined) {
        // An action round: the baskets, coloured on the same red → green
        // scale by the share of the points they earned (worst → best).
        const td = h('td', { dataset: { cell: 'scale' },
            title: `${hits} קליעות · ${pts ?? 0} נק׳` }, `${hits}`, h('small', { class: 'gk-matrix-dev', text: '🏀' }));
        td.style.setProperty('--acc', `${Math.round((share ?? 0) * 100)}%`);
        return td;
    }
    if (dev !== null && dev !== undefined) {
        // A slider answer is not right or wrong: the colour runs linearly
        // from red (100% off) to green (exact), by the same factor that
        // scaled its points; under the seconds, how far off it was.
        const accuracy = Math.max(0, 1 - Math.abs(dev));
        const pct = Math.round(Math.abs(dev) * 100);
        const td = h('td', { dataset: { cell: 'scale' }, dir: 'ltr',
            title: `סטייה של ${pct}% (${dev > 0 ? 'גדול מדי' : dev < 0 ? 'קטן מדי' : 'מדויק'}) · ${fmtSeconds(ms)} שניות · ${pts ?? 0} נק׳` },
            fmtSeconds(ms), h('small', { class: 'gk-matrix-dev', text: `${dev > 0 ? '+' : dev < 0 ? '−' : ''}${pct}%` }));
        td.style.setProperty('--acc', `${Math.round(accuracy * 100)}%`);
        return td;
    }
    return ok
        ? h('td', { dataset: { cell: 'good' }, dir: 'ltr', text: fmtSeconds(ms), title: `נכון, אחרי ${fmtSeconds(ms)} שניות${pts !== undefined ? ` · ${pts} נק׳` : ''}` })
        : h('td', { dataset: { cell: 'bad' }, text: '✕', title: 'טעות' });
}

export function matrix(data) {
    const questions = data?.questions || [];
    const rows = data?.rows || [];
    return h('div', { class: 'gk-matrix-wrap' },
        h('table', { class: 'gk-matrix' },
            h('thead', null, h('tr', null,
                h('th', { class: 'gk-matrix-name', text: 'שחקן' }),
                questions.map((q) => h('th', { title: q.title, text: `${q.no}${q.weight === 2 ? ' ×2' : q.weight === 0 ? ' ×0' : ''}`, dir: 'ltr' })),
                h('th', { text: 'סה״כ' }))),
            h('tbody', null, rows.map((row) => h('tr', null,
                // The cell stays right-to-left whatever the name's language; only the
                // name itself is isolated (<bdi>), so 'Guy' reads correctly and
                // still sits against the right edge beside its rank, like 'מור'.
                h('th', { class: 'gk-matrix-name' }, `${row.rank}. `, h('bdi', { text: row.name })),
                questions.map((_, i) => matrixCell(row.cells?.[i])),
                h('td', { class: 'gk-matrix-total', text: String(row.points) }))))));
}

// ---- confetti -------------------------------------------------------------
const CONFETTI_COLORS = ['#e2162f', '#1c4fd6', '#ffc61a', '#7a2bc4', '#1fbf63', '#ffffff'];

/** A few seconds of falling paper on a fixed canvas, which removes itself. */
export function confetti({ duration = 7000, delay = 0 } = {}) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = h('canvas', { class: 'gk-confetti' });
    const ctx = canvas.getContext('2d');
    let pieces = [];
    let started = 0;

    const frame = (now) => {
        if (!canvas.isConnected) return;
        if (!started) started = now;
        const age = now - started;
        const w = canvas.width = canvas.clientWidth;
        const hgt = canvas.height = canvas.clientHeight;
        if (!pieces.length) {
            pieces = Array.from({ length: 170 }, () => ({
                x: Math.random() * w, y: -Math.random() * hgt, r: 5 + Math.random() * 8,
                vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 4,
                spin: Math.random() * Math.PI, vs: -.2 + Math.random() * .4,
                color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            }));
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, (duration - age) / 1200));
        for (const p of pieces) {
            p.x += p.vx; p.y += p.vy; p.spin += p.vs;
            if (p.y > hgt + 20) { p.y = -20; p.x = Math.random() * w; }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.spin);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
            ctx.restore();
        }
        if (age < duration) requestAnimationFrame(frame);
        else canvas.remove();
    };
    setTimeout(() => { document.body.append(canvas); requestAnimationFrame(frame); }, delay);
}

// ---- money ----------------------------------------------------------------
/**
 * Banknotes bursting from the middle of the screen and fluttering down — the
 * roulette's prize, on the device of a player whose number came up (the host
 * asked for it). Drawn on a canvas like the confetti, so it looks the same on
 * every phone (an emoji 💵 is a different picture on each).
 */
export function moneyRain({ duration = 4200 } = {}) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = h('canvas', { class: 'gk-confetti' });
    const ctx = canvas.getContext('2d');
    let bills = [];
    let started = 0;

    function bill(b) {
        const bw = b.s, bh = b.s * 0.48;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.scale(1, Math.cos(b.flip));            // the note turning over as it falls
        // Light paper with a dark rim and a shadow: it must read on the green
        // "stadium" theme as well as on the dark ones.
        ctx.shadowColor = 'rgba(0, 0, 0, .45)';
        ctx.shadowBlur = bw * 0.08;
        ctx.shadowOffsetY = bw * 0.03;
        ctx.fillStyle = Math.cos(b.flip) > 0 ? '#b9e39a' : '#9fd17f';
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#1b5a31';
        ctx.lineWidth = Math.max(1.5, bw * 0.03);
        ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
        ctx.strokeStyle = '#3f8f52';
        ctx.lineWidth = Math.max(1, bw * 0.03);
        ctx.strokeRect(-bw * 0.42, -bh * 0.34, bw * 0.84, bh * 0.68);
        ctx.fillStyle = '#e8f7dc';
        ctx.beginPath();
        ctx.arc(0, 0, bh * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b5a31';
        ctx.font = `900 ${Math.round(bh * 0.38)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('₪', 0, bh * 0.02);
        ctx.restore();
    }

    const frame = (now) => {
        if (!canvas.isConnected) return;
        if (!started) started = now;
        const age = now - started;
        const w = canvas.width = canvas.clientWidth;
        const hgt = canvas.height = canvas.clientHeight;
        if (!bills.length) {
            const size = Math.max(46, Math.min(w, hgt) * 0.16);
            bills = Array.from({ length: 46 }, () => {
                const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;   // upwards, fanned out
                const v = 9 + Math.random() * 11;
                return {
                    x: w / 2 + (Math.random() - 0.5) * w * 0.1, y: hgt * 0.55,
                    vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                    s: size * (0.75 + Math.random() * 0.5),
                    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.12,
                    flip: Math.random() * Math.PI, vf: 0.08 + Math.random() * 0.12,
                    sway: Math.random() * Math.PI * 2,
                };
            });
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, (duration - age) / 900));
        for (const b of bills) {
            // a burst, then air resistance: the notes float down, swaying
            b.vy = Math.min(b.vy + 0.35, 2.6);
            b.vx *= 0.97;
            b.sway += 0.06;
            b.x += b.vx + Math.sin(b.sway) * 1.2;
            b.y += b.vy;
            b.rot += b.vr;
            b.flip += b.vf;
            bill(b);
        }
        if (age < duration) requestAnimationFrame(frame);
        else canvas.remove();
    };
    document.body.append(canvas);
    requestAnimationFrame(frame);
}

// ---- the winner ---------------------------------------------------------------
/**
 * "You won": the winner's own device, as first place lands on the podium —
 * the host asked for the winner to have a moment of their own. A full-screen
 * card (trophy, turning gold rays, their name and score) over the podium,
 * gone on a tap or after `duration`. The podium itself (every screen) has its
 * own rays behind the first column — css/base.css.
 */
export function winnerMoment({ name, points, players, duration = 7500 }) {
    const card = h('div', { class: 'gk-win', role: 'dialog', 'aria-label': 'ניצחת בחידון' },
        h('div', { class: 'gk-win-rays', 'aria-hidden': 'true' }),
        h('div', { class: 'gk-win-body' },
            h('span', { class: 'gk-win-trophy', 'aria-hidden': 'true', text: '🏆' }),
            h('p', { class: 'gk-win-title', text: 'ניצחת!' }),
            h('p', { class: 'gk-win-name', dir: 'auto', text: name || '' }),
            h('p', { class: 'gk-win-sub', text: `מקום ראשון מתוך ${players} · ${points} נקודות` }),
            h('p', { class: 'gk-win-hint', text: 'הקישו כדי לראות את הפודיום' })));
    const close = () => {
        if (card.dataset.out !== undefined) return;
        card.dataset.out = '';
        setTimeout(() => card.remove(), 500);
    };
    card.addEventListener('click', close);
    setTimeout(close, duration);
    document.body.append(card);
    confetti({ duration: 6500 });
}
