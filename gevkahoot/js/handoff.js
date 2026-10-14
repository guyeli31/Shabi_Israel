/**
 * handoff.js — handoff.html: the goodbye slide after a live quiz.
 *
 * The Shabi Israel loading screen, driven for exactly five seconds: the ring
 * is built by the site's own buildRing() (its square count from the saved
 * design, --n in splash-vars.css), its squares light one by one as the
 * seconds pass, it closes the way the site's does, and the page moves on to
 * the site's main page. replace(), not assign(): Back from the site should
 * not land on a goodbye that sends you forward again.
 */
import { buildRing } from '../../shabi-israel/js/utils/splashConfig.js';

const WAIT_MS = 5000;
const TARGET = '../shabi-israel/';

const splash = document.getElementById('logo-splash');
const ring = splash.querySelector('.sp-ring');
const detail = splash.querySelector('.sp-detail');
const n = parseInt(getComputedStyle(ring).getPropertyValue('--n'), 10) || 24;
buildRing(ring, n);
const squares = [...ring.querySelectorAll('.sq')];
document.documentElement.classList.add('sp-active');

const t0 = performance.now();
function tick(now) {
    const t = Math.min(1, (now - t0) / WAIT_MS);
    const lit = Math.round(t * n);
    squares.forEach((sq, i) => sq.classList.toggle('is-lit', i < lit));
    const left = Math.max(0, Math.ceil((WAIT_MS - (now - t0)) / 1000));
    detail.textContent = left ? `מעבר בעוד ${left}…` : 'עוברים…';
    if (t < 1) { requestAnimationFrame(tick); return; }
    splash.classList.add('is-closing');
    setTimeout(() => location.replace(TARGET), 350);
}
requestAnimationFrame(tick);
