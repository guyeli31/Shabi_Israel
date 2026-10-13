/**
 * completeMaker.js — turn any picture into a "complete the picture" question.
 *
 * The host picks a picture and draws a free-hand outline around one object in
 * it. Two files come out:
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
 * simple, dependable kind: each hidden pixel is filled from the visible pixels
 * around the outline, working inwards, and the fill is then relaxed until it is
 * smooth. On sky, grass, a wall, a table — it is convincing. Over a busy
 * background (a crowd, patterned fabric) it leaves a soft blur where the
 * object was. That is fine for this game: the players are told something is
 * missing, and the gap is marked on their screen anyway.
 */
import { h, clear } from '../ui/dom.js';
import { saveMediaFile, canSaveMedia, MEDIA_NAME_RE } from './spriteCutter.js';

const MAX_SIDE = 1400;     // working size of the picture, px (longest side)
const PIECE_MAX = 640;     // of the saved cut-out, px

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

    // ---- the mask: the outline, grown a little -----------------------------
    // A hand-drawn outline hugs the object; a rim of its edge pixels left
    // behind would be smeared inwards by the fill as a ghost of its colour.
    const grow = Math.max(3, Math.round(Math.max(W, H) * 0.006));
    const maskCanvas = h('canvas', { width: String(W), height: String(H) });
    const mc = maskCanvas.getContext('2d');
    trace(mc);
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
    // ---- 3. a little grain --------------------------------------------------
    // A perfectly smooth patch in a photograph reads as "edited". The rest of
    // the picture has sensor noise; the patch gets a touch of its own.
    for (const i of hidden) {
        const n = (Math.random() - 0.5) * 7;
        px[i * 4] = r[i] + n; px[i * 4 + 1] = g[i] + n; px[i * 4 + 2] = b[i] + n;
    }
    hc.putImageData(image, 0, 0);
    return { hole, piece, slot: { x: +(x0 / W).toFixed(4), y: +(y0 / H).toFixed(4), w: +(bw / W).toFixed(4), h: +(bh / H).toFixed(4) } };
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export function openCompleteMaker({ onSaved }) {
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
    let fit = null;        // where it is drawn on the editing canvas
    let points = [];       // the outline, in editing-canvas pixels
    let drawing = false;
    let result = null;     // { hole, piece, slot }

    function paint() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!work) return;
        ctx.drawImage(result ? result.hole : work, fit.x, fit.y, fit.w, fit.h);
        if (result || points.length < 2) return;
        const path = new Path2D();
        points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
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
    canvas.addEventListener('pointerdown', (e) => {
        if (!work || result) return;
        canvas.setPointerCapture(e.pointerId);
        drawing = true; points = [at(e)];
        removeBtn.disabled = true; againBtn.disabled = false;
        paint();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = at(e);
        const [lx, ly] = points[points.length - 1];
        if (Math.hypot(p[0] - lx, p[1] - ly) > 2) { points.push(p); paint(); }
    });
    const finish = () => {
        if (!drawing) return;
        drawing = false;
        const usable = points.length >= 8;
        if (!usable) points = [];
        removeBtn.disabled = !usable;
        status.textContent = usable ? 'האזור המסומן באדום ייצא מהתמונה. אפשר לסמן מחדש, או ללחוץ "הוצא את העצם".' : 'הקיפו בגרירה את העצם שרוצים להוציא מהתמונה.';
        paint();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    againBtn.onclick = () => { restart(); status.textContent = 'הקיפו בגרירה את העצם שרוצים להוציא מהתמונה.'; };

    removeBtn.onclick = () => {
        status.textContent = 'מוציא את העצם וממלא את הרקע…';
        removeBtn.disabled = true;
        // Let the status line paint before the (synchronous) number-crunching.
        setTimeout(() => {
            const k = work.width / fit.w;
            const outline = points.map(([x, y]) => [(x - fit.x) * k, (y - fit.y) * k]);
            result = removeObject(work, outline);
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

    const picker = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'בחירת תמונה', onchange: async () => {
        const file = picker.files?.[0];
        if (!file) return;
        let bitmap;
        try { bitmap = await createImageBitmap(file); } catch { status.textContent = 'לא הצלחתי לקרוא את הקובץ הזה כתמונה.'; return; }
        const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        work = h('canvas', { width: String(Math.round(bitmap.width * k)), height: String(Math.round(bitmap.height * k)) });
        work.getContext('2d').drawImage(bitmap, 0, 0, work.width, work.height);
        bitmap.close?.();
        const s = Math.min(canvas.width / work.width, canvas.height / work.height);
        fit = { w: work.width * s, h: work.height * s };
        fit.x = (canvas.width - fit.w) / 2;
        fit.y = (canvas.height - fit.h) / 2;
        if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[/\\?#%:*"<>|]/g, '').replace(/^\.+/, '');
        restart();
        status.textContent = 'הקיפו בגרירה את העצם שרוצים להוציא מהתמונה.';
    } });

    const dialog = h('dialog', { class: 'sc kit', dir: 'rtl', 'aria-label': 'יצירת שאלת השלמת תמונה' },
        h('div', { class: 'sc-head' },
            h('h2', { text: 'השלמת תמונה — הוצאת עצם מהתמונה' }),
            h('button', { class: 'dr-x', type: 'button', 'aria-label': 'סגור', text: '✕', onclick: () => dialog.close() })),
        h('div', { class: 'sc-body' },
            h('div', { class: 'sc-row' }, picker, againBtn, removeBtn),
            canvas,
            h('div', { class: 'sc-row sc-out' }, pieceBox,
                h('div', { class: 'sc-save' }, nameInput, h('div', { class: 'sc-row' }, saveBtn, downloadBtn))),
            status));
    dialog.addEventListener('close', () => { clear(dialog); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
}
