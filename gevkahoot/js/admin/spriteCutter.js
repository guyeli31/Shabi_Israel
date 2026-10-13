/**
 * spriteCutter.js — make an animation sprite out of any picture.
 *
 * Pick an image, draw a free-hand outline around the part you want, and what
 * is inside the outline becomes a transparent-background PNG: the shape that
 * the quiz's animation multiplies and bounces around the screen.
 *
 * Nothing is uploaded anywhere. The picture is read and cut in this browser,
 * and the result is written as a FILE into gevkahoot/media/sprites/ — the same
 * place every other media file lives — together with the regenerated
 * media/manifest.json, through the File System Access API (the mechanism the
 * main site's Splash Editor saves with). That needs Chrome or Edge and the
 * editor running from your working copy; anywhere else the PNG is offered as a
 * download instead, to be dropped into the folder by hand.
 *
 * Like every media file, a new sprite reaches the live site with the next
 * commit and push.
 */
import { h, clear } from '../ui/dom.js';

const MAX_SIDE = 512;          // of the saved sprite, in px
const FOLDERS = ['images', 'backgrounds', 'videos', 'audio', 'sprites'];   // manifest key order

let mediaDir = null;           // the granted gevkahoot/media handle, kept for the session

/** Add a file name to manifest.json exactly as scripts/gevkahoot-media-manifest.mjs
 *  would have written it, so `--check` still passes afterwards. */
async function addToManifest(dir, folder, name) {
    const handle = await dir.getFileHandle('manifest.json');
    const current = JSON.parse(await (await handle.getFile()).text());
    const next = {};
    for (const key of FOLDERS) next[key] = [...(current[key] || [])];
    if (!next[folder].includes(name)) next[folder].push(name);
    next[folder].sort((a, b) => a.localeCompare(b, 'en'));
    const writable = await handle.createWritable();
    await writable.write(`${JSON.stringify(next, null, 2)}\n`);
    await writable.close();
}

/**
 * Write one generated file into gevkahoot/media/<folder>/ and list it in the
 * manifest. Shared by every editor tool that makes media (this cutter, the
 * "complete the picture" maker): the folder is asked for once per session.
 */
export async function saveMediaFile(folder, name, blob) {
    if (!mediaDir) {
        const picked = await window.showDirectoryPicker({ id: 'gevkahoot-media', mode: 'readwrite' });
        // The one folder that holds manifest.json is gevkahoot/media — refuse
        // anything else rather than scatter media folders somewhere random.
        try { await picked.getFileHandle('manifest.json'); } catch { throw new Error('wrong_folder'); }
        mediaDir = picked;
    }
    const dir = await mediaDir.getDirectoryHandle(folder, { create: true });
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    await addToManifest(mediaDir, folder, name);
}
export const canSaveMedia = () => 'showDirectoryPicker' in window;
export const MEDIA_NAME_RE = /^[^./\\?#%:*"<>|\u0000-\u001f][^/\\?#%:*"<>|\u0000-\u001f]*$/;

export function openSpriteCutter({ onSaved }) {
    const canvas = h('canvas', { class: 'sc-canvas', width: '760', height: '480' });
    const ctx = canvas.getContext('2d');
    const result = h('canvas', { class: 'sc-result' });
    const status = h('p', { class: 'dr-note', role: 'status', text: 'בחרו תמונה כדי להתחיל.' });
    const nameInput = h('input', { class: 'dr-input', type: 'text', maxlength: '60', dir: 'auto', placeholder: 'שם הקובץ', 'aria-label': 'שם הקובץ' });
    const cutBtn = h('button', { class: 'gk-btn gk-btn--small', type: 'button', text: 'חתוך ✂', disabled: true });
    const saveBtn = h('button', { class: 'gk-btn gk-btn--small', type: 'button', text: 'שמירה לתיקיית המדיה', disabled: true });
    const downloadBtn = h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: 'הורדה כקובץ', disabled: true });
    const resetBtn = h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: 'נקה סימון', disabled: true });

    let image = null;      // ImageBitmap of the picked file
    let fit = null;        // { x, y, w, h } — where the image is drawn on the canvas
    let points = [];       // the outline, in canvas pixels
    let drawing = false;
    let cut = null;        // Blob of the result

    function paint() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!image) return;
        ctx.drawImage(image, fit.x, fit.y, fit.w, fit.h);
        if (points.length < 2) return;
        const path = new Path2D();
        points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
        if (!drawing) {
            // Outline finished: dim everything outside it, so what will be
            // kept is unmistakable before cutting.
            path.closePath();
            const shade = new Path2D();
            shade.rect(0, 0, canvas.width, canvas.height);
            shade.addPath(path);
            ctx.fillStyle = 'rgba(8, 10, 20, .68)';
            ctx.fill(shade, 'evenodd');
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
    canvas.addEventListener('pointerdown', (e) => {
        if (!image) return;
        canvas.setPointerCapture(e.pointerId);
        drawing = true; points = [at(e)]; cut = null;
        cutBtn.disabled = true; saveBtn.disabled = true; downloadBtn.disabled = true; resetBtn.disabled = false;
        result.hidden = true;
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
        cutBtn.disabled = !usable;
        status.textContent = usable ? 'מה שבתוך הקו יישמר. אפשר לסמן מחדש, או ללחוץ "חתוך".' : 'הקיפו בגרירה את החלק שרוצים לשמור.';
        paint();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    resetBtn.onclick = () => { points = []; cut = null; cutBtn.disabled = true; saveBtn.disabled = true; downloadBtn.disabled = true; result.hidden = true; paint(); };

    cutBtn.onclick = async () => {
        // Map the outline from canvas pixels back to the picture's own pixels,
        // so the sprite is cut from the original and not from the preview.
        const k = image.width / fit.w;
        const src = points.map(([x, y]) => [(x - fit.x) * k, (y - fit.y) * k]);
        const xs = src.map((p) => p[0]);
        const ys = src.map((p) => p[1]);
        const left = Math.max(0, Math.min(...xs));
        const top = Math.max(0, Math.min(...ys));
        const width = Math.min(image.width, Math.max(...xs)) - left;
        const height = Math.min(image.height, Math.max(...ys)) - top;
        if (width < 4 || height < 4) { status.textContent = 'הסימון קטן מדי.'; return; }
        const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
        result.width = Math.round(width * scale);
        result.height = Math.round(height * scale);
        const out = result.getContext('2d');
        out.clearRect(0, 0, result.width, result.height);
        out.save();
        out.scale(scale, scale);
        out.translate(-left, -top);
        out.beginPath();
        src.forEach(([x, y], i) => (i ? out.lineTo(x, y) : out.moveTo(x, y)));
        out.closePath();
        out.clip();
        out.imageSmoothingQuality = 'high';
        out.drawImage(image, 0, 0);
        out.restore();
        cut = await new Promise((resolve) => result.toBlob(resolve, 'image/png'));
        result.hidden = false;
        saveBtn.disabled = !('showDirectoryPicker' in window);
        downloadBtn.disabled = false;
        status.textContent = 'showDirectoryPicker' in window
            ? `הדמות מוכנה (${result.width}×${result.height}). תנו לה שם ושמרו — בפעם הראשונה תתבקשו לבחור את התיקייה gevkahoot/media.`
            : `הדמות מוכנה (${result.width}×${result.height}). בדפדפן הזה אין שמירה ישירה: הורידו את הקובץ, שימו אותו ב-gevkahoot/media/sprites והריצו node scripts/gevkahoot-media-manifest.mjs.`;
    };

    function fileName() {
        let name = nameInput.value.trim().replace(/\.(png|jpe?g|webp|gif|avif)$/i, '');
        if (!name || !MEDIA_NAME_RE.test(name)) return null;
        return `${name}.png`;
    }

    saveBtn.onclick = async () => {
        const name = fileName();
        if (!name) { status.textContent = 'שם הקובץ לא יכול להכיל / \\ ? # % : * " < > | או להתחיל בנקודה.'; return; }
        saveBtn.disabled = true;
        try {
            await saveMediaFile('sprites', name, cut);
            dialog.close();
            onSaved(`media/sprites/${name}`);
        } catch (err) {
            saveBtn.disabled = false;
            if (err.name === 'AbortError') return;   // the folder picker was dismissed
            status.textContent = err.message === 'wrong_folder'
                ? 'זו לא התיקייה הנכונה. בחרו את gevkahoot/media (זו שיש בה manifest.json).'
                : `השמירה נכשלה: ${err.message}`;
        }
    };

    downloadBtn.onclick = () => {
        const name = fileName() || 'sprite.png';
        const url = URL.createObjectURL(cut);
        const a = h('a', { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    const picker = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'בחירת תמונה', onchange: async () => {
        const file = picker.files?.[0];
        if (!file) return;
        try {
            image = await createImageBitmap(file);
        } catch {
            status.textContent = 'לא הצלחתי לקרוא את הקובץ הזה כתמונה.';
            return;
        }
        const k = Math.min(canvas.width / image.width, canvas.height / image.height);
        fit = { w: image.width * k, h: image.height * k };
        fit.x = (canvas.width - fit.w) / 2;
        fit.y = (canvas.height - fit.h) / 2;
        points = []; cut = null; result.hidden = true;
        cutBtn.disabled = true; saveBtn.disabled = true; downloadBtn.disabled = true; resetBtn.disabled = true;
        if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[/\\?#%:*"<>|]/g, '').replace(/^\.+/, '');
        status.textContent = 'הקיפו בגרירה (עכבר או אצבע) את החלק שרוצים לשמור.';
        paint();
    } });

    result.hidden = true;
    const dialog = h('dialog', { class: 'sc kit', dir: 'rtl', 'aria-label': 'יצירת דמות לאנימציה' },
        h('div', { class: 'sc-head' },
            h('h2', { text: 'יצירת דמות לאנימציה' }),
            h('button', { class: 'dr-x', type: 'button', 'aria-label': 'סגור', text: '✕', onclick: () => dialog.close() })),
        h('div', { class: 'sc-body' },
            h('div', { class: 'sc-row' }, picker, resetBtn, cutBtn),
            canvas,
            h('div', { class: 'sc-row sc-out' }, result,
                h('div', { class: 'sc-save' }, nameInput, h('div', { class: 'sc-row' }, saveBtn, downloadBtn))),
            status));
    dialog.addEventListener('close', () => { image?.close?.(); clear(dialog); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
}
