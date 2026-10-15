/**
 * puzzle.js — the five-piece jigsaw.
 *
 * A picture is cut into five classic jigsaw pieces — two across the top, three
 * across the bottom, joined by knobs and sockets — which start scattered
 * beside an empty frame the size of the picture. A player drags each piece
 * into the frame; a piece let go close to where it belongs snaps exactly into
 * place and locks. When all five are home, the puzzle reports it (and the
 * stage offers "done").
 *
 * ALL of this runs in the player's browser. Dragging sends nothing anywhere:
 * the server hears from a puzzle exactly once per player, when they press
 * "done" (gk_answer). A room of two hundred people dragging pieces costs the
 * backend the same as a room of two hundred people thinking.
 *
 * The pieces are not five image files: each is an element showing the whole
 * picture as its background, shifted so the right part is visible and clipped
 * to the piece's outline. So any picture in the media folder is a puzzle with
 * no preparation, and the cut is the same on every device.
 *
 * Everything is kept in fractions — of the play area for a loose piece, of the
 * frame for a placed one — and turned into pixels only when laying out, so
 * rotating a phone or resizing a window moves nothing out of place.
 */
import { h } from '../ui/dom.js';
import { holdTouch } from '../ui/touch.js';

/** The five cells, in the unit square: two on top, three underneath. */
const T = 1 / 3;
const CELLS = [
    { x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
    { x0: 0.5, y0: 0, x1: 1, y1: 0.5 },
    { x0: 0, y0: 0.5, x1: T, y1: 1 },
    { x0: T, y0: 0.5, x1: 2 * T, y1: 1 },
    { x0: 2 * T, y0: 0.5, x1: 1, y1: 1 },
];

/**
 * The joints. Each is a point on a line two cells share, and `n` is the way
 * its knob points: the piece on that side has a socket there, the piece on the
 * other side carries the knob. A joint is defined ONCE and both neighbours
 * trace the same curve, so a knob always fits its socket exactly.
 *
 * The top row's seam (x = ½) and the bottom row's seams (x = ⅓, ⅔) do not line
 * up, which is what makes five pieces interlock: the middle bottom piece
 * touches both top pieces.
 */
const JOINTS = [
    { x: 0.5, y: 0.25, n: [1, 0] },      // top-left  → top-right
    { x: 1 / 6, y: 0.5, n: [0, -1] },    // bottom-left ↑ top-left
    { x: 5 / 6, y: 0.5, n: [0, 1] },     // top-right ↓ bottom-right
    { x: T, y: 0.75, n: [-1, 0] },       // bottom-middle → bottom-left
    { x: 2 * T, y: 0.75, n: [1, 0] },    // bottom-middle → bottom-right
];

/** A knob, in units of the knob size: a short neck, then a round head. */
const NECK_HALF = 0.13, NECK_LEN = 0.12, HEAD_R = 0.27;
/** How far a knob reaches past the cell edge (same units) — the margin every
 *  piece's box carries on all sides so its knobs have room. */
const REACH = NECK_LEN + Math.sqrt(HEAD_R ** 2 - NECK_HALF ** 2) + HEAD_R + 0.02;

const near = (a, b) => Math.abs(a - b) < 1e-6;

/**
 * The outline of one piece as an SVG path in pixels, relative to the piece's
 * own box (which is its cell grown by `pad` on every side). It has to be
 * rebuilt for each size: a knob is round, and a path in percentages would
 * squash it into an ellipse on any picture that is not square.
 */
function outline(cell, fw, fh, knob, pad) {
    const X = (fx) => (fx - cell.x0) * fw + pad;
    const Y = (fy) => (fy - cell.y0) * fh + pad;
    const out = [`M${X(cell.x0).toFixed(2)} ${Y(cell.y0).toFixed(2)}`];
    const line = (x, y) => out.push(`L${x.toFixed(2)} ${y.toFixed(2)}`);

    // Walk the four sides clockwise. On each, pass through every joint that
    // lies on it, in the order the walk meets them.
    const sides = [
        { d: [1, 0], on: (j) => near(j.y, cell.y0) && j.x > cell.x0 && j.x < cell.x1, key: (j) => j.x, end: [cell.x1, cell.y0] },
        { d: [0, 1], on: (j) => near(j.x, cell.x1) && j.y > cell.y0 && j.y < cell.y1, key: (j) => j.y, end: [cell.x1, cell.y1] },
        { d: [-1, 0], on: (j) => near(j.y, cell.y1) && j.x > cell.x0 && j.x < cell.x1, key: (j) => -j.x, end: [cell.x0, cell.y1] },
        { d: [0, -1], on: (j) => near(j.x, cell.x0) && j.y > cell.y0 && j.y < cell.y1, key: (j) => -j.y, end: [cell.x0, cell.y0] },
    ];
    for (const side of sides) {
        const [dx, dy] = side.d;
        for (const j of JOINTS.filter(side.on).sort((a, b) => side.key(a) - side.key(b))) {
            const [nx, ny] = j.n;
            const cx = X(j.x), cy = Y(j.y);
            const a = NECK_HALF * knob, len = NECK_LEN * knob, r = HEAD_R * knob;
            line(cx - dx * a, cy - dy * a);                                   // to the neck
            line(cx - dx * a + nx * len, cy - dy * a + ny * len);             // up the neck
            // Round the head, the long way, to the other side of the neck. The
            // sweep direction depends on which way this walk crosses the joint.
            const sweep = dx * ny - dy * nx > 0 ? 0 : 1;
            out.push(`A${r.toFixed(2)} ${r.toFixed(2)} 0 1 ${sweep} ${(cx + dx * a + nx * len).toFixed(2)} ${(cy + dy * a + ny * len).toFixed(2)}`);
            line(cx + dx * a, cy + dy * a);                                   // back down
        }
        line(X(side.end[0]), Y(side.end[1]));
    }
    return `${out.join(' ')} Z`;
}

/** How close (as a fraction of the frame's width) counts as "in place". */
const SNAP = 0.12;

/**
 * @param image        a validated media path
 * @param interactive  false on the projected screen: the pieces are shown
 *                     scattered, for the room to see what is being solved
 * @param onChange     called with true/false whenever "all five placed" flips
 */
export function createPuzzle({ image, interactive, onChange }) {
    const frame = h('div', { class: 'pz-frame' });
    const root = h('div', { class: 'pz', dataset: interactive ? { live: '' } : {} }, frame);
    if (interactive) holdTouch(root);
    let ratio = 4 / 3;           // picture width / height, until it has loaded
    let locked = false;
    let complete = false;
    let geometry = null;         // { W, H, fx, fy, fw, fh, pad } in px

    const pieces = CELLS.map((cell, i) => {
        // Two elements per piece: the outer one is positioned and casts the
        // shadow; the inner one ("face") shows the picture and is clipped to
        // the jigsaw outline. One element cannot do both — a clip-path also
        // clips the element's own drop-shadow. Only the face takes the
        // pointer, so the empty corners of a piece's box cannot be grabbed and
        // do not block the piece lying underneath.
        const face = h('div', { class: 'pz-face' });
        face.style.backgroundImage = `url("${image}")`;
        const el = h('div', { class: 'pz-piece', dataset: { piece: String(i) } }, face);
        root.append(el);
        return { cell, el, face, placed: false, u: null, v: null };   // u/v: the CELL's top-left, fractions of the play area
    });

    function measure() {
        const W = root.clientWidth, H = root.clientHeight;
        if (!W || !H) return null;
        // The frame takes the top of a tall play area and the side of a wide
        // one; what is left is the tray the loose pieces lie in. (Enlarged at
        // the host's request — 0.46 / 0.56 before: the picture is the game.)
        const tall = H > W;
        const maxW = tall ? W : W * 0.62;
        const maxH = tall ? H * 0.52 : H;
        const fw = Math.min(maxW, maxH * ratio);
        const fh = fw / ratio;
        const fx = tall ? (W - fw) / 2 : W - fw;       // right-hand side: the page is RTL
        const fy = tall ? 0 : (H - fh) / 2;
        // One knob size for the whole puzzle, from its smallest cell side.
        const knob = 0.5 * Math.min(fw / 3, fh / 2);
        return { W, H, fx, fy, fw, fh, tall, knob, pad: REACH * knob };
    }

    const size = (p, g) => ({ w: (p.cell.x1 - p.cell.x0) * g.fw, h: (p.cell.y1 - p.cell.y0) * g.fh });

    function scatter(g) {
        const gap = g.pad;   // room for a knob between the frame and the tray
        const tray = g.tall
            ? { x: 0, y: g.fh + gap, w: g.W, h: g.H - g.fh - gap }
            : { x: 0, y: 0, w: g.W - g.fw - gap, h: g.H };
        // One loose slot per piece, handed out in a random order, so none
        // starts buried under another and the pieces do not always lie in
        // reading order. A tray tall enough for two rows (a phone's, under the
        // frame) gets two: five pieces side by side do not fit a phone's width.
        const tallest = g.fh / 2;
        const rows = tray.h >= tallest * 1.9 ? 2 : 1;
        const cols = Math.ceil(pieces.length / rows);
        const order = pieces.map((_, i) => i).sort(() => Math.random() - 0.5);
        const slotW = tray.w / cols, slotH = tray.h / rows;
        pieces.forEach((p, i) => {
            const { w, h: ph } = size(p, g);
            const col = order[i] % cols, row = Math.floor(order[i] / cols);
            const x = tray.x + slotW * col + Math.random() * Math.max(0, slotW - w);
            const y = tray.y + slotH * row + Math.random() * Math.max(0, slotH - ph);
            p.u = Math.max(tray.x, Math.min(x, tray.x + tray.w - w)) / g.W;
            p.v = Math.max(tray.y, Math.min(y, tray.y + tray.h - ph)) / g.H;
        });
    }

    function layout() {
        const g = measure();
        if (!g) return;
        geometry = g;
        frame.style.width = `${g.fw}px`;
        frame.style.height = `${g.fh}px`;
        frame.style.transform = `translate(${g.fx}px, ${g.fy}px)`;
        if (pieces[0].u === null) scatter(g);
        for (const p of pieces) {
            const { w, h: ph } = size(p, g);
            const x = p.placed ? g.fx + p.cell.x0 * g.fw : Math.max(0, Math.min(p.u * g.W, g.W - w));
            const y = p.placed ? g.fy + p.cell.y0 * g.fh : Math.max(0, Math.min(p.v * g.H, g.H - ph));
            // The box is the cell plus the knob margin all round, so it is
            // placed that margin up-and-left of where the cell itself goes.
            p.el.style.width = `${w + 2 * g.pad}px`;
            p.el.style.height = `${ph + 2 * g.pad}px`;
            p.el.style.transform = `translate(${x - g.pad}px, ${y - g.pad}px)`;
            p.face.style.backgroundSize = `${g.fw}px ${g.fh}px`;
            p.face.style.backgroundPosition = `${g.pad - p.cell.x0 * g.fw}px ${g.pad - p.cell.y0 * g.fh}px`;
            p.face.style.clipPath = `path("${outline(p.cell, g.fw, g.fh, g.knob, g.pad)}")`;
            p.el.toggleAttribute('data-placed', p.placed);
        }
    }

    function report() {
        const now = pieces.every((p) => p.placed);
        if (now !== complete) { complete = now; root.toggleAttribute('data-complete', complete); onChange?.(complete); }
    }

    if (interactive) {
        let top = 10;
        for (const p of pieces) {
            let grab = null;   // pointer offset from the cell's top-left corner
            p.face.addEventListener('pointerdown', (e) => {
                if (locked || p.placed || !geometry) return;
                e.preventDefault();
                p.face.setPointerCapture(e.pointerId);
                const box = p.el.getBoundingClientRect();
                grab = { dx: e.clientX - box.left - geometry.pad, dy: e.clientY - box.top - geometry.pad };
                p.el.style.zIndex = String(++top);
                p.el.toggleAttribute('data-held', true);
            });
            p.face.addEventListener('pointermove', (e) => {
                if (!grab) return;
                const g = geometry;
                const area = root.getBoundingClientRect();
                const { w, h: ph } = size(p, g);
                const x = Math.min(Math.max(0, e.clientX - area.left - grab.dx), g.W - w);
                const y = Math.min(Math.max(0, e.clientY - area.top - grab.dy), g.H - ph);
                p.u = x / g.W; p.v = y / g.H;
                p.el.style.transform = `translate(${x - g.pad}px, ${y - g.pad}px)`;
            });
            const drop = () => {
                if (!grab) return;
                grab = null;
                p.el.toggleAttribute('data-held', false);
                const g = geometry;
                const homeX = g.fx + p.cell.x0 * g.fw, homeY = g.fy + p.cell.y0 * g.fh;
                // Near enough is exactly right: the piece is moved the rest of
                // the way and locked, so a finished puzzle is pixel-true.
                if (Math.hypot(p.u * g.W - homeX, p.v * g.H - homeY) <= SNAP * g.fw) {
                    p.placed = true;
                    p.el.style.zIndex = '1';
                }
                layout();
                report();
            };
            p.face.addEventListener('pointerup', drop);
            p.face.addEventListener('pointercancel', drop);
        }
    }

    const probe = new Image();
    probe.onload = () => { if (probe.naturalWidth && probe.naturalHeight) { ratio = probe.naturalWidth / probe.naturalHeight; layout(); } };
    probe.src = image;
    new ResizeObserver(layout).observe(root);

    return {
        el: root,
        /** Freeze the puzzle. `solved` shows it assembled (this player finished). */
        lock(solved) {
            if (locked && !solved) return;
            locked = true;
            root.toggleAttribute('data-locked', true);
            if (solved) { for (const p of pieces) p.placed = true; layout(); }
        },
        get complete() { return complete; },
    };
}

/**
 * Cut a round detail out of a picture, as an image URL the bouncing animation
 * can use. `circle` is { x, y, r }: the centre as fractions of the picture's
 * width and height, the radius as a fraction of its shorter side.
 */
const cutouts = new Map();
export function circleCutout(image, circle) {
    const key = `${image}|${circle.x}|${circle.y}|${circle.r}`;
    if (!cutouts.has(key)) {
        cutouts.set(key, new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth || 800, hgt = img.naturalHeight || 600;
                const r = circle.r * Math.min(w, hgt);
                // Exactly the round piece of the picture — no frame — since it
                // is first seen sitting in the picture, where it came from.
                const size = Math.round(Math.min(640, Math.max(240, r * 2)));
                const canvas = h('canvas', { width: String(size), height: String(size) });
                const ctx = canvas.getContext('2d');
                ctx.beginPath();
                ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(img, circle.x * w - r, circle.y * hgt - r, r * 2, r * 2, 0, 0, size, size);
                canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
            };
            img.onerror = () => resolve(null);
            img.src = image;
        }));
    }
    return cutouts.get(key);
}
