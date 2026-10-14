/**
 * completeMaker.js — turn any picture into a "complete the picture" question.
 *
 * The host picks a picture already in the repo (media/images or
 * media/backgrounds — never a file from the computer) and marks one object in
 * it: a free-hand outline, a dragged rectangle, or a dragged circle (Shift
 * keeps it round). Two files come out:
 *
 *   the picture WITHOUT the object — the outlined area is painted over with
 *     the background that surrounds it (see removeObject below);
 *   the object itself — a transparent-background cut-out, which the question
 *     then offers at several sizes, one of them the real one.
 *
 * Both are made in this browser — nothing is uploaded — and written into
 * gevkahoot/media/ like every other media file (images/ and sprites/), with the
 * manifest updated, through the same File System Access path as the sprite
 * cutter. As with all media, they reach the live site on the next commit+push.
 *
 * ABOUT THE "FILTER". Painting an object out is inpainting, and this is the
 * simple, dependable kind, in two layers:
 *   the colour — each hidden pixel is filled from the visible pixels around
 *     the outline, working inwards, and the fill is then relaxed until it is
 *     smooth (the soft blur);
 *   the texture — on top of that, the fine detail of REAL pixels from just
 *     outside the outline, mirrored inwards across it, so the patch has the
 *     grain, the grass blades, the brick of its surroundings rather than the
 *     flat look of a blur.
 * The area painted over is the outline enlarged 1.5 times about its centre:
 * a hand-drawn outline misses the object's soft edge and its shadow, and the
 * slider question draws the object SMALLER than it was, so a rim left behind
 * would show. On sky, grass, a wall, a table — it is convincing. Over a busy
 * background (a crowd, patterned fabric) it is a plausible smear, not an
 * invisible repair; the gap is marked on the players' screen anyway.
 */
import { h, clear } from '../ui/dom.js';
import { saveMediaFile, canSaveMedia, MEDIA_NAME_RE, repoImagePicker } from './spriteCutter.js';

const MAX_SIDE = 1400;     // working size of the picture, px (longest side)
const PIECE_MAX = 640;     // of the saved cut-out, px
const TEXTURE_CAP = 14;    // largest detail copied into the patch, per channel (0-255)

/**
 * @param source  a canvas holding the picture
 * @param outline [[x, y], …] in the canvas's pixels
 * @returns { hole: canvas, piece: canvas, slot: {x, y, w, h} in fractions }
 */
export function removeObject(source, outline) {
    const W = source.width, H = source.height;
    const trace = (ctx) => { ctx.beginPath(); outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

    // ---- the cut-out: exactly what is inside the outline --------------------
    const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(W, Math.ceil(Math.max(...xs))), y1 = Math.min(H, Math.ceil(Math.max(...ys)));
    const bw = x1 - x0, bh = y1 - y0;
    const k = Math.min(1, PIECE_MAX / Math.max(bw, bh));
    const piece = h('canvas', { width: String(Math.max(1, Math.round(bw * k))), height: String(Math.max(1, Math.round(bh * k))) });
    const pc = piece.getContext('2d');
    pc.scale(k, k);
    pc.translate(-x0, -y0);
    trace(pc);
    pc.clip();
    pc.drawImage(source, 0, 0);

    // ---- the mask: the outline enlarged 1.5×, and grown a little ------------
    // A hand-drawn outline hugs the object; a rim of its edge pixels (or its
    // shadow) left behind would be smeared inwards by the fill as a ghost of
    // its colour — and would show around a piece drawn smaller than it was.
    const grow = Math.max(3, Math.round(Math.max(W, H) * 0.006));
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const wide = outline.map(([x, y]) => [cx + (x - cx) * 1.5, cy + (y - cy) * 1.5]);
    const maskCanvas = h('canvas', { width: String(W), height: String(H) });
    const mc = maskCanvas.getContext('2d');
    mc.beginPath(); wide.forEach(([x, y], i) => (i ? mc.lineTo(x, y) : mc.moveTo(x, y))); mc.closePath();
    mc.fillStyle = '#000'; mc.fill();
    mc.lineWidth = grow * 2; mc.lineJoin = 'round'; mc.strokeStyle = '#000'; mc.stroke();
    const alpha = mc.getImageData(0, 0, W, H).data;

    const hole = h('canvas', { width: String(W), height: String(H) });
    const hc = hole.getContext('2d');
    hc.drawImage(source, 0, 0);
    const image = hc.getImageData(0, 0, W, H);
    const px = image.data;

    // 0 = visible, 1 = hidden and not yet filled, 2 = hidden and filled
    const state = new Uint8Array(W * H);
    const hidden = [];
    for (let i = 0; i < W * H; i++) if (alpha[i * 4 + 3] > 0) { state[i] = 1; hidden.push(i); }
    if (!hidden.length) return { hole, piece, slot: { x: x0 / W, y: y0 / H, w: bw / W, h: bh / H } };
    const visible = (i) => state[i] === 0;
    // The picture's fine detail: each visible pixel minus the average of the
    // VISIBLE pixels around it (so the object itself never leaks in).
    const detail = detailLayer(px, W, H, visible, Math.max(3, Math.round(Math.max(W, H) * 0.004)));

    // ---- 1. fill inwards, ring by ring --------------------------------------
    // The outermost hidden pixels take the average of their visible
    // neighbours; they then count as visible for the next ring in.
    const neighbours = (i, cb) => {
        const x = i % W, y = (i / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H) cb(ny * W + nx);
        }
    };
    const queued = new Uint8Array(W * H);
    let ring = [];
    for (const i of hidden) {
        let edge = false;
        neighbours(i, (n) => { if (state[n] === 0) edge = true; });
        if (edge) { ring.push(i); queued[i] = 1; }
    }
    while (ring.length) {
        const colours = new Float32Array(ring.length * 3);
        ring.forEach((i, r) => {
            let sr = 0, sg = 0, sb = 0, n = 0;
            neighbours(i, (q) => { if (state[q] !== 1) { sr += px[q * 4]; sg += px[q * 4 + 1]; sb += px[q * 4 + 2]; n += 1; } });
            colours[r * 3] = sr / n; colours[r * 3 + 1] = sg / n; colours[r * 3 + 2] = sb / n;
        });
        const next = [];
        ring.forEach((i, r) => { px[i * 4] = colours[r * 3]; px[i * 4 + 1] = colours[r * 3 + 1]; px[i * 4 + 2] = colours[r * 3 + 2]; px[i * 4 + 3] = 255; });
        for (const i of ring) state[i] = 2;
        for (const i of ring) neighbours(i, (q) => { if (state[q] === 1 && !queued[q]) { queued[q] = 1; next.push(q); } });
        ring = next;
    }

    // ---- 2. relax -----------------------------------------------------------
    // The ring fill leaves streaks pointing at the centre. Repeatedly replacing
    // each filled pixel by the mean of its four neighbours (the visible rim
    // stays fixed) settles into the smoothest surface that meets the rim.
    const r = new Float32Array(W * H), g = new Float32Array(W * H), b = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) { r[i] = px[i * 4]; g[i] = px[i * 4 + 1]; b[i] = px[i * 4 + 2]; }
    const passes = Math.min(400, Math.max(60, Math.round(Math.sqrt(hidden.length) * 0.7)));
    for (let pass = 0; pass < passes; pass++) {
        for (const i of hidden) {
            const x = i % W, y = (i / W) | 0;
            const l = x > 0 ? i - 1 : i, rt = x < W - 1 ? i + 1 : i, u = y > 0 ? i - W : i, d = y < H - 1 ? i + W : i;
            r[i] = (r[l] + r[rt] + r[u] + r[d]) / 4;
            g[i] = (g[l] + g[rt] + g[u] + g[d]) / 4;
            b[i] = (b[l] + b[rt] + b[u] + b[d]) / 4;
        }
    }
    // ---- 3. real texture -------------------------------------------------
    // A perfectly smooth patch in a photograph reads as "edited". So the hole
    // is covered in tiles, and each tile borrows the fine detail of a real
    // patch of the picture just outside the hole (a constant shift per tile,
    // so the texture is copied whole, not smeared pixel by pixel). A pixel
    // blends the shifts of the four tiles around it, so there are no seams.
    const tile = Math.max(12, Math.round(Math.max(W, H) * 0.022));
    const cap = (v) => Math.max(-TEXTURE_CAP, Math.min(TEXTURE_CAP, v));
    let mx = 0, my = 0;
    for (const i of hidden) { mx += i % W; my += (i / W) | 0; }
    mx /= hidden.length; my /= hidden.length;
    const okAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H && visible((y | 0) * W + (x | 0));
    const shifts = new Map();   // "tx,ty" → [dx, dy] or null
    const shiftFor = (tx, ty) => {
        const key = `${tx},${ty}`;
        if (shifts.has(key)) return shifts.get(key);
        const cx = (tx + 0.5) * tile, cy = (ty + 0.5) * tile;
        // Out from the hole's centre first, then the other directions; the
        // nearest distance at which the whole tile lands on real picture wins.
        const out = Math.atan2(cy - my, cx - mx) || 0;
        let best = null;
        for (let step = 1; step <= 40 && !best; step++) {
            for (let k = 0; k < 8 && !best; k++) {
                const a = out + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 4;
                const dx = Math.round(Math.cos(a) * step * tile * 0.5), dy = Math.round(Math.sin(a) * step * tile * 0.5);
                let ok = true;
                for (const fx of [-0.5, 0, 0.5]) for (const fy of [-0.5, 0, 0.5]) if (ok && !okAt(cx + fx * tile + dx, cy + fy * tile + dy)) ok = false;
                if (ok) best = [dx, dy];
            }
        }
        shifts.set(key, best);
        return best;
    };
    for (const i of hidden) {
        const x = i % W, y = (i / W) | 0;
        const fx = x / tile - 0.5, fy = y / tile - 0.5;
        const tx = Math.floor(fx), ty = Math.floor(fy), ax = fx - tx, ay = fy - ty;
        let dr = 0, dg = 0, db = 0, wsum = 0;
        for (const [ux, uy, w] of [[tx, ty, (1 - ax) * (1 - ay)], [tx + 1, ty, ax * (1 - ay)], [tx, ty + 1, (1 - ax) * ay], [tx + 1, ty + 1, ax * ay]]) {
            const sh = shiftFor(ux, uy);
            if (!sh || w <= 0) continue;
            const sx = x + sh[0], sy = y + sh[1];
            if (!okAt(sx, sy)) continue;
            const q = sy * W + sx;
            // Only texture, not edges: a strong contrast (the outline of a
            // face, a railing) copied in draws lines, so the detail is capped.
            dr += w * cap(detail[q * 3]); dg += w * cap(detail[q * 3 + 1]); db += w * cap(detail[q * 3 + 2]);
            wsum += w;
        }
        const k = wsum > 0 ? 1 / wsum : 0;
        px[i * 4] = r[i] + dr * k; px[i * 4 + 1] = g[i] + dg * k; px[i * 4 + 2] = b[i] + db * k;
    }
    hc.putImageData(image, 0, 0);
    return { hole, piece, slot: { x: +(x0 / W).toFixed(4), y: +(y0 / H).toFixed(4), w: +(bw / W).toFixed(4), h: +(bh / H).toFixed(4) } };
}

/** Per visible pixel, its colour minus the mean of the visible pixels within
 *  `rad` of it: the texture without the shading. Integral images, so it costs
 *  the same at any radius. Hidden pixels get 0 and count for nothing. */
function detailLayer(px, W, H, visible, rad) {
    const S = (W + 1) * (H + 1);
    const sum = [new Float64Array(S), new Float64Array(S), new Float64Array(S)], cnt = new Float64Array(S);
    for (let y = 0; y < H; y++) {
        let a0 = 0, a1 = 0, a2 = 0, c = 0;
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (visible(i)) { a0 += px[i * 4]; a1 += px[i * 4 + 1]; a2 += px[i * 4 + 2]; c += 1; }
            const k = (y + 1) * (W + 1) + x + 1, u = y * (W + 1) + x + 1;
            sum[0][k] = sum[0][u] + a0; sum[1][k] = sum[1][u] + a1; sum[2][k] = sum[2][u] + a2; cnt[k] = cnt[u] + c;
        }
    }
    const box = (arr, xa, ya, xb, yb) => arr[yb * (W + 1) + xb] - arr[ya * (W + 1) + xb] - arr[yb * (W + 1) + xa] + arr[ya * (W + 1) + xa];
    const out = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) {
        const ya = Math.max(0, y - rad), yb = Math.min(H, y + rad + 1);
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (!visible(i)) continue;
            const xa = Math.max(0, x - rad), xb = Math.min(W, x + rad + 1);
            const n = box(cnt, xa, ya, xb, yb);
            for (let c = 0; c < 3; c++) out[i * 3 + c] = px[i * 4 + c] - box(sum[c], xa, ya, xb, yb) / n;
        }
    }
    return out;
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export function openCompleteMaker({ onSaved, manifest, title = 'השלמת תמונה — הוצאת עצם מהתמונה' }) {
    const canvas = h('canvas', { class: 'sc-canvas', width: '760', height: '480' });
    const ctx = canvas.getContext('2d');
    const pieceBox = h('div', { class: 'sc-result cm-piece', hidden: true });
    const status = h('p', { class: 'dr-note', role: 'status', text: 'בחרו תמונה כדי להתחיל.' });
    const nameInput = h('input', { class: 'dr-input', type: 'text', maxlength: '60', dir: 'auto', placeholder: 'שם לקבצים', 'aria-label': 'שם לקבצים' });
    const removeBtn = h('button', { class: 'gk-btn gk-btn--small', type: 'button', text: 'הוצא את העצם ✂', disabled: true });
    const againBtn = h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: 'סמן מחדש', disabled: true });
    const saveBtn = h('button', { class: 'gk-btn gk-btn--small', type: 'button', text: 'שמירה ויצירת השאלה', disabled: true });
    const downloadBtn = h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: 'הורדת שני הקבצים', disabled: true });

    let work = null;       // the picture at working size (canvas)
    // The outline is kept in WORK-picture pixels, not screen pixels, so it
    // stays exactly on the object while the view zooms in and out.
    let points = [];
    let drawing = false;
    let result = null;     // { hole, piece, slot }
    // How the object is marked: a free-hand outline, a rectangle, or a circle
    // (an ellipse in the dragged box; Shift keeps it round). Every shape ends
    // up as the same outline of points, so removeObject() needs no change.
    let shape = 'free';
    let anchor = null;     // where a rectangle / circle drag began (work px)
    const HINT = {
        free: 'הקיפו בגרירה את העצם שרוצים להוציא מהתמונה.',
        rect: 'גררו מלבן סביב העצם שרוצים להוציא מהתמונה.',
        circle: 'גררו עיגול סביב העצם (מפינה לפינה; Shift שומר על עיגול מושלם).',
        zoom: 'גררו ריבוע סביב האזור שרוצים להגדיל.',
    };

    // ---- zoom ----------------------------------------------------------------
    // The part of the picture on screen is `view`, a rectangle in work pixels
    // drawn as large as the canvas allows. "🔍" makes the next drag pick a
    // SQUARE, and the view becomes that square (widened to the canvas's
    // proportions, so nothing is stretched); "↩" goes back one zoom, "⌂" to
    // the whole picture. Marking works the same at any zoom — and so does
    // looking at the result: the fill can be inspected up close.
    let view = null;       // { x, y, w, h } in work pixels
    let views = [];        // the views before this one, for "back"
    let zooming = false;   // the next drag picks the square to zoom to
    let zoomBox = null;    // [a, b] — that square while it is dragged, canvas px
    const MIN_VIEW = 24;   // work px: as far in as it goes
    const scaleOf = () => Math.min(canvas.width / view.w, canvas.height / view.h);
    const originOf = () => { const s = scaleOf(); return [(canvas.width - view.w * s) / 2, (canvas.height - view.h * s) / 2]; };
    const toCanvas = ([x, y]) => { const s = scaleOf(), [ox, oy] = originOf(); return [ox + (x - view.x) * s, oy + (y - view.y) * s]; };
    const toWork = ([px, py]) => { const s = scaleOf(), [ox, oy] = originOf(); return [view.x + (px - ox) / s, view.y + (py - oy) / s]; };
    const whole = () => ({ x: 0, y: 0, w: work.width, h: work.height });

    const zoomBtn = h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: '🔍 זום לריבוע', disabled: true,
        title: 'גררו ריבוע על התמונה כדי להגדיל אותו' });
    const backBtn = h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: '↩ אחורה', disabled: true,
        title: 'חזרה לזום הקודם' });
    const homeBtn = h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: '⌂ כל התמונה', disabled: true,
        title: 'חזרה לתמונה המלאה' });
    function syncZoom() {
        zoomBtn.disabled = !work;
        zoomBtn.toggleAttribute('data-on', zooming);
        zoomBtn.textContent = zooming ? '🔍 גררו ריבוע…' : '🔍 זום לריבוע';
        backBtn.disabled = !views.length;
        homeBtn.disabled = !views.length;
        canvas.style.cursor = zooming ? 'zoom-in' : 'crosshair';
    }
    const hint = () => (zooming ? HINT.zoom : result ? status.textContent : HINT[shape]);
    zoomBtn.onclick = () => { zooming = !zooming; zoomBox = null; syncZoom(); status.textContent = hint(); paint(); };
    backBtn.onclick = () => { if (views.length) view = views.pop(); zooming = false; syncZoom(); paint(); };
    homeBtn.onclick = () => { view = whole(); views = []; zooming = false; syncZoom(); paint(); };
    /** Zoom to the square dragged from canvas point a to b. */
    function zoomTo([ax, ay], [bx, by]) {
        const [wa, wb] = [toWork([ax, ay]), toWork([bx, by])];
        const side = Math.max(MIN_VIEW, Math.abs(wb[0] - wa[0]), Math.abs(wb[1] - wa[1]));
        const cx = (wa[0] + wb[0]) / 2, cy = (wa[1] + wb[1]) / 2;
        const aspect = canvas.width / canvas.height;
        const w = side * Math.max(1, aspect), hgt = side * Math.max(1, 1 / aspect);
        views.push(view);
        view = { x: cx - w / 2, y: cy - hgt / 2, w, h: hgt };
    }

    /** The outline of a rectangle / circle dragged from a to b (work px), as points. */
    function shapeOutline([ax, ay], [bx, by], round) {
        if (round) { const d = Math.max(Math.abs(bx - ax), Math.abs(by - ay)); bx = ax + Math.sign(bx - ax || 1) * d; by = ay + Math.sign(by - ay || 1) * d; }
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
        if (shape === 'rect') {
            const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
            const pts = [];
            for (let c = 0; c < 4; c++) for (let i = 0; i < 12; i++) {
                const t = i / 12, [px, py] = corners[c], [qx, qy] = corners[c + 1];
                pts.push([px + (qx - px) * t, py + (qy - py) * t]);
            }
            return pts;
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
        return Array.from({ length: 72 }, (_, i) => [cx + rx * Math.cos(i * Math.PI / 36), cy + ry * Math.sin(i * Math.PI / 36)]);
    }
    const shapeSeg = h('div', { class: 'if-seg if-seg--words', role: 'radiogroup', 'aria-label': 'צורת הסימון' },
        [['free', '✍ צורה חופשית'], ['rect', '▭ מלבן'], ['circle', '◯ עיגול']].map(([key, label]) => h('button', {
            type: 'button', class: 'if-seg-btn', text: label, dataset: key === shape ? { on: '' } : {},
            onclick: (e) => {
                shape = key;
                zooming = false; syncZoom();
                for (const b of shapeSeg.children) b.toggleAttribute('data-on', b === e.currentTarget);
                // A new shape starts a new marking (an object already taken out stays).
                if (!result) { points = []; removeBtn.disabled = true; paint(); }
                if (work && !result) status.textContent = HINT[shape];
            } })));

    function paint() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!work) return;
        const s = scaleOf(), [ox, oy] = originOf();
        ctx.drawImage(result ? result.hole : work, ox - view.x * s, oy - view.y * s, work.width * s, work.height * s);
        if (!result && points.length >= 2) {
            const path = new Path2D();
            points.map(toCanvas).forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
            if (!drawing) {
                // Finished outline: tint what will be taken OUT (the reverse of
                // the sprite cutter, where the inside is what is kept).
                path.closePath();
                ctx.fillStyle = 'rgba(226, 22, 47, .35)';
                ctx.fill(path);
            }
            ctx.lineJoin = 'round';
            ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0, 0, 0, .7)'; ctx.stroke(path);
            ctx.lineWidth = 2; ctx.setLineDash([7, 5]); ctx.strokeStyle = '#fff'; ctx.stroke(path);
            ctx.setLineDash([]);
        }
        if (zoomBox) {
            const [[ax, ay], [bx, by]] = zoomBox;
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, .7)'; ctx.strokeRect(ax, ay, bx - ax, by - ay);
            ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffd60a'; ctx.strokeRect(ax, ay, bx - ax, by - ay);
            ctx.setLineDash([]);
        }
    }

    const at = (e) => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
    };
    function restart() {
        points = []; result = null;
        pieceBox.hidden = true;
        removeBtn.disabled = true; againBtn.disabled = true; saveBtn.disabled = true; downloadBtn.disabled = true;
        paint();
    }
    /** The square being dragged: from a, as far as the longer side of a→p. */
    const square = ([ax, ay], [px, py]) => {
        const d = Math.max(Math.abs(px - ax), Math.abs(py - ay));
        return [[ax, ay], [ax + Math.sign(px - ax || 1) * d, ay + Math.sign(py - ay || 1) * d]];
    };
    canvas.addEventListener('pointerdown', (e) => {
        if (!work) return;
        if (zooming) {
            canvas.setPointerCapture(e.pointerId);
            const p = at(e);
            zoomBox = [p, p];
            return;
        }
        if (result) return;
        canvas.setPointerCapture(e.pointerId);
        drawing = true;
        anchor = toWork(at(e));
        points = shape === 'free' ? [anchor] : shapeOutline(anchor, anchor, e.shiftKey);
        removeBtn.disabled = true; againBtn.disabled = false;
        paint();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (zoomBox) { zoomBox = square(zoomBox[0], at(e)); paint(); return; }
        if (!drawing) return;
        const p = at(e);
        if (shape !== 'free') { points = shapeOutline(anchor, toWork(p), e.shiftKey); paint(); return; }
        const [lx, ly] = toCanvas(points[points.length - 1]);
        if (Math.hypot(p[0] - lx, p[1] - ly) > 2) { points.push(toWork(p)); paint(); }
    });
    const finish = () => {
        if (zoomBox) {
            const [[ax, ay], [bx, by]] = zoomBox;
            zoomBox = null;
            // A click without a drag is no square: stay in zoom mode.
            if (Math.abs(bx - ax) >= 10) { zoomTo([ax, ay], [bx, by]); zooming = false; }
            syncZoom();
            status.textContent = hint();
            paint();
            return;
        }
        if (!drawing) return;
        drawing = false;
        // A free outline needs some length; a shape needs some size on screen.
        const shown = points.map(toCanvas);
        const xs = shown.map((q) => q[0]), ys = shown.map((q) => q[1]);
        const usable = shape === 'free' ? points.length >= 8
            : Math.max(...xs) - Math.min(...xs) >= 8 && Math.max(...ys) - Math.min(...ys) >= 8;
        if (!usable) points = [];
        removeBtn.disabled = !usable;
        status.textContent = usable ? 'האזור המסומן באדום ייצא מהתמונה. אפשר לסמן מחדש, או ללחוץ "הוצא את העצם".' : HINT[shape];
        paint();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    againBtn.onclick = () => { restart(); status.textContent = HINT[shape]; };

    removeBtn.onclick = () => {
        status.textContent = 'מוציא את העצם וממלא את הרקע…';
        removeBtn.disabled = true;
        // Let the status line paint before the (synchronous) number-crunching.
        setTimeout(() => {
            result = removeObject(work, points);
            if (result.slot.w < 0.02 || result.slot.h < 0.02) { restart(); status.textContent = 'הסימון קטן מדי.'; return; }
            clear(pieceBox).append(result.piece);
            pieceBox.hidden = false;
            saveBtn.disabled = !canSaveMedia();
            downloadBtn.disabled = false;
            status.textContent = canSaveMedia()
                ? 'כך תיראה התמונה למשתתפים, ומשמאל העצם שיצא. תנו שם ושמרו — בפעם הראשונה תתבקשו לבחור את התיקייה gevkahoot/media.'
                : 'בדפדפן הזה אין שמירה ישירה: הורידו את שני הקבצים, שימו את התמונה ב-media/images ואת העצם ב-media/sprites, והריצו node scripts/gevkahoot-media-manifest.mjs.';
            paint();
        }, 30);
    };

    function names() {
        const base = nameInput.value.trim().replace(/\.(png|jpe?g|webp|gif|avif)$/i, '');
        if (!base || !MEDIA_NAME_RE.test(base)) return null;
        return { image: `${base}.jpg`, piece: `${base}-piece.png` };
    }

    saveBtn.onclick = async () => {
        const n = names();
        if (!n) { status.textContent = 'השם לא יכול להכיל / \\ ? # % : * " < > | או להתחיל בנקודה.'; return; }
        saveBtn.disabled = true;
        try {
            await saveMediaFile('images', n.image, await toBlob(result.hole, 'image/jpeg', 0.9));
            await saveMediaFile('sprites', n.piece, await toBlob(result.piece, 'image/png'));
            const slot = result.slot;
            dialog.close();
            onSaved({ image: `media/images/${n.image}`, piece: `media/sprites/${n.piece}`, slot });
        } catch (err) {
            saveBtn.disabled = false;
            if (err.name === 'AbortError') return;
            status.textContent = err.message === 'wrong_folder'
                ? 'זו לא התיקייה הנכונה. בחרו את gevkahoot/media (זו שיש בה manifest.json).'
                : `השמירה נכשלה: ${err.message}`;
        }
    };

    downloadBtn.onclick = async () => {
        const n = names() || { image: 'picture.jpg', piece: 'picture-piece.png' };
        for (const [name, blob] of [[n.image, await toBlob(result.hole, 'image/jpeg', 0.9)], [n.piece, await toBlob(result.piece, 'image/png')]]) {
            const url = URL.createObjectURL(blob);
            const a = h('a', { href: url, download: name });
            dialog.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
    };

    // The picture comes from the repo's media folder, never from the computer.
    const picker = repoImagePicker(manifest, (bitmap, base) => {
        if (!bitmap) { status.textContent = 'לא הצלחתי לקרוא את התמונה הזאת.'; return; }
        const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        work = h('canvas', { width: String(Math.round(bitmap.width * k)), height: String(Math.round(bitmap.height * k)) });
        work.getContext('2d').drawImage(bitmap, 0, 0, work.width, work.height);
        bitmap.close?.();
        // A new picture starts whole, with no zoom history.
        view = whole(); views = []; zooming = false; zoomBox = null;
        syncZoom();
        // The result is a NEW picture beside the original, never over it.
        if (!nameInput.value) nameInput.value = `${base}-בלי-העצם`;
        restart();
        status.textContent = HINT[shape];
    });

    const dialog = h('dialog', { class: 'sc kit', dir: 'rtl', 'aria-label': 'יצירת שאלת השלמת תמונה' },
        h('div', { class: 'sc-head' },
            h('h2', { text: title }),
            h('button', { class: 'dr-x', type: 'button', 'aria-label': 'סגור', text: '✕', onclick: () => dialog.close() })),
        h('div', { class: 'sc-body' },
            h('div', { class: 'sc-row' }, picker, shapeSeg, againBtn, removeBtn),
            h('div', { class: 'sc-row' }, zoomBtn, backBtn, homeBtn),
            canvas,
            h('div', { class: 'sc-row sc-out' }, pieceBox,
                h('div', { class: 'sc-save' }, nameInput, h('div', { class: 'sc-row' }, saveBtn, downloadBtn))),
            status));
    dialog.addEventListener('close', () => { clear(dialog); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
}
