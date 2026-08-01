/**
 * popupLang.js — Site-wide language preference for "?" info popups.
 *
 * Global (not per-popup): clicking a flag on ANY popup sets the preference
 * for every popup on every page, persisted across reloads. Popups render
 * both languages inline (two `[data-lang]` blocks each) and this module
 * just flips which one is visible, via a `data-active-lang` attribute on
 * the popup element that CSS keys off (see .predictor-info-popup rules in
 * dashboard.css) — no innerHTML swapping, no re-render.
 */

const STORAGE_KEY = 'shabi-popup-lang';
const EVENT_NAME = 'shabi-popup-lang-change';
export const DEFAULT_LANG = 'en';

export const LANG_FLAGS = {
    en: { icon: 'assets/lang-icons/GB.png', label: 'English' },
    he: { icon: 'assets/lang-icons/IL.png', label: 'עברית' },
};

export function getPopupLang() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === 'he' ? 'he' : DEFAULT_LANG;
    } catch {
        return DEFAULT_LANG;
    }
}

export function setPopupLang(lang) {
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // Storage unavailable (private browsing, etc.) — the toggle still
        // works for the current page load via the broadcast below, it just
        // won't survive a reload.
    }
    document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { lang } }));
}

export function onPopupLangChange(callback) {
    document.addEventListener(EVENT_NAME, (e) => callback(e.detail.lang));
}

/**
 * Builds the flag-pair control markup for a section header, next to a "?"
 * button. Caller wires click handlers via wireLangFlags below.
 */
export function langFlagsHtml() {
    return `
        <span class="popup-lang-flags">
            ${Object.entries(LANG_FLAGS).map(([lang, { icon, label }]) => `
                <button type="button" class="popup-lang-flag" data-lang="${lang}" title="${label}">
                    <img src="${icon}" alt="${label}" width="18" height="18">
                </button>
            `).join('')}
        </span>
    `;
}

/**
 * Wires a section's flag buttons + "?" button + popup together:
 * - "?" toggles the popup open/closed, in the current global language.
 * - a flag click sets the global language (broadcasting to every other
 *   open/closed popup on the page), then makes sure THIS popup is open.
 * - the popup's `data-active-lang` attribute always tracks the current
 *   global language, even while closed, so opening it never shows stale
 *   language on the first frame.
 *
 * `root` scopes the querySelectorAll to a specific header element (needed
 * on the landing page, where multiple per-league-type instances of the
 * same ids/classes exist in the DOM at once).
 *
 * `onLangPick(lang)` (optional) fires only when the user CLICKS a flag here —
 * not when this popup merely follows another popup's language broadcast — so a
 * caller can log the deliberate choice without every sibling popup logging it too.
 */
export function wireLangPopup(root, { btn, popup, close, onOpen, onLangPick } = {}) {
    if (!popup) return;
    const flagBtns = (root || document).querySelectorAll('.popup-lang-flag');

    function applyLang(lang) {
        popup.dataset.activeLang = lang;
        flagBtns.forEach((flagBtn) => {
            flagBtn.classList.toggle('is-active', flagBtn.dataset.lang === lang);
        });
    }
    applyLang(getPopupLang());

    if (btn) {
        btn.addEventListener('click', () => {
            popup.hidden = !popup.hidden;
            if (!popup.hidden && onOpen) onOpen();
        });
    }
    if (close) {
        close.addEventListener('click', () => { popup.hidden = true; });
    }

    flagBtns.forEach((flagBtn) => {
        flagBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setPopupLang(flagBtn.dataset.lang);
            popup.hidden = false;
            if (onOpen) onOpen();
            if (onLangPick) onLangPick(flagBtn.dataset.lang);
        });
    });

    onPopupLangChange(applyLang);
}

// Popups whose entire innerHTML is rebuilt on every redraw (Gaussian-fit
// stats, Model-validation table — driven by a toggle button, not a "?", and
// regenerated on every control change, not just opened once). Their flag
// buttons are destroyed and recreated each rebuild, so click handlers must
// be re-wired every time — but the cross-popup language-change SUBSCRIPTION
// must only be registered once per popup element, or every redraw would
// stack another listener onto the same still-alive element.
const dynamicPopupsWired = new WeakSet();

export function wireDynamicLangPopup(popup) {
    if (!popup) return;

    function applyLang(lang) {
        popup.dataset.activeLang = lang;
        popup.querySelectorAll('.popup-lang-flag').forEach((flagBtn) => {
            flagBtn.classList.toggle('is-active', flagBtn.dataset.lang === lang);
        });
    }
    applyLang(getPopupLang());

    popup.querySelectorAll('.popup-lang-flag').forEach((flagBtn) => {
        flagBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setPopupLang(flagBtn.dataset.lang);
        });
    });

    if (!dynamicPopupsWired.has(popup)) {
        dynamicPopupsWired.add(popup);
        onPopupLangChange(applyLang);
    }
}
