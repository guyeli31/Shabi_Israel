/*
 * analytics-boot.js — the first lines analytics.html runs: what the main
 * site's analytics page does in its inline <head> script, which this page's
 * CSP (script-src 'self', no inline) does not allow.
 *
 *   1. the saved theme, on <html> before the first paint (the same migrations
 *      of retired theme names as the site's pages);
 *   2. the loading screen's ring, built as soon as its markup exists — its
 *      square count from --n, which the saved design (splash-vars.css) sets;
 *   3. the fail-safe: if the page's module never runs, the splash goes after
 *      25s rather than covering the page for ever.
 *
 * A classic script beside the page, not in js/: the build bundles js/ away
 * (as with legacy.js). ES5 on purpose — it must not be the thing that fails.
 */
(function () {
    try {
        var t = localStorage.getItem('shabi-theme');
        if (t === 'modern') t = 'nature';
        if (t === 'royal') t = 'vegas';
        if (t && t !== 'current') { document.documentElement.setAttribute('data-theme', t); localStorage.setItem('shabi-theme', t); }
        var c = localStorage.getItem('shabi-custom-vars');
        if (c) { var v = JSON.parse(c); for (var k in v) document.documentElement.style.setProperty(k, v[k]); }
    } catch (e) { /* no storage: the default theme */ }

    function buildRing() {
        var ring = document.querySelector('#logo-splash .sp-ring');
        if (!ring || ring.querySelector('.sq')) return;
        var n = parseInt(getComputedStyle(ring).getPropertyValue('--n'), 10) || 24;
        var f = document.createDocumentFragment();
        for (var i = 0; i < n; i++) {
            var d = document.createElement('div');
            d.className = 'sq';
            d.style.setProperty('--i', i);
            d.style.setProperty('--a', (i * 360 / n) + 'deg');
            f.appendChild(d);
        }
        ring.insertBefore(f, ring.firstChild);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildRing);
    else buildRing();

    setTimeout(function () {
        var s = document.getElementById('logo-splash');
        if (s && !s.getAttribute('data-done')) { s.parentNode.removeChild(s); document.documentElement.classList.remove('sp-active'); }
    }, 25000);
})();
