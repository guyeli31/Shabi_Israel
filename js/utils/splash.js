const SHOW_DELAY_MS = 500;

let _timerId = null;
let _splashEl = null;

function _getOrCreate() {
    let el = document.getElementById('logo-splash');
    if (!el) {
        el = document.createElement('div');
        el.id = 'logo-splash';
        el.className = 'logo-splash';
        el.setAttribute('aria-hidden', 'true');
        const img = document.createElement('img');
        img.className = 'logo-splash-img';
        img.src = 'assets/logo/logo.png';
        img.alt = '';
        el.appendChild(img);
        document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
}

export function startSplash() {
    _splashEl = _getOrCreate();
    _timerId = setTimeout(() => {
        _timerId = null;
        if (_splashEl) _splashEl.classList.add('splash-visible');
    }, SHOW_DELAY_MS);
}

export function updateSplashLogo(src) {
    if (!src) return;
    const img = document.querySelector('#logo-splash .logo-splash-img');
    if (img) img.src = src;
}

export function endSplash() {
    if (_timerId !== null) {
        // Loaded before delay fired — never show
        clearTimeout(_timerId);
        _timerId = null;
        _splashEl = null;
        return;
    }
    if (!_splashEl) return;
    const el = _splashEl;
    _splashEl = null;
    el.classList.remove('splash-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
}
