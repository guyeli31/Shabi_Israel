// components/Splash/splash.js — full-screen logo overlay with a "show
// only if loading took > delay" guard. Direct port of v1 utils/splash.js
// with the asset path updated to v2's /assets/ proxy.

const SHOW_DELAY_MS = 500;
const DEFAULT_LOGO = "/assets/logo/logo.png";

let _timerId = null;
let _splashEl = null;

function getOrCreate(logoSrc) {
    let el = document.getElementById("logo-splash");
    if (!el) {
        el = document.createElement("div");
        el.id = "logo-splash";
        el.className = "splash";
        el.setAttribute("aria-hidden", "true");
        const img = document.createElement("img");
        img.className = "splash__img";
        img.src = logoSrc;
        img.alt = "";
        el.appendChild(img);
        document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
}

export function startSplash(logoSrc = DEFAULT_LOGO) {
    _splashEl = getOrCreate(logoSrc);
    _timerId = setTimeout(() => {
        _timerId = null;
        if (_splashEl) _splashEl.classList.add("splash--visible");
    }, SHOW_DELAY_MS);
}

export function updateSplashLogo(src) {
    if (!src) return;
    const img = document.querySelector("#logo-splash .splash__img");
    if (img) img.src = src;
}

export function endSplash() {
    if (_timerId !== null) {
        clearTimeout(_timerId);
        _timerId = null;
        _splashEl = null;
        return;
    }
    if (!_splashEl) return;
    const el = _splashEl;
    _splashEl = null;
    el.classList.remove("splash--visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
}
