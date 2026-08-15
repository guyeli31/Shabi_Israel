/**
 * privacyNotice.js — passive transparency notice ("Privacy & Analytics"
 * footer link + modal).
 *
 * NOT a consent banner: nothing blocks the page and nothing is gated on it.
 * It exists to satisfy the transparency/notice duty (which is distinct from
 * consent) — disclosing the functional localStorage (display preferences +
 * league-data cache) and the anonymous, IP-free analytics.
 *
 * Single canonical language source: this module owns ONLY the privacy TEXT
 * (en/he). The language STATE and the flag control both come from
 * popupLang.js — the same UK/IL toggle used by every info "?" popup, via
 * `langFlagsHtml()` (markup) + get/set/onPopupLangChange (state, persisted in
 * localStorage key 'shabi-popup-lang'). Changing the language anywhere
 * (this modal or any popup) updates everywhere; default is English
 * (popupLang.DEFAULT_LANG). No language config is duplicated here.
 *
 * Self-contained: injects its own scoped <style> once (themed via the site's
 * --color-* tokens) and lazily builds the modal on first open, so it works
 * without touching per-page CSS includes. A single delegated click listener
 * handles every `[data-action="privacy"]` trigger (the dashboard footer
 * link), added once at import — importing this module on a page wires it up.
 */
import { getPopupLang, setPopupLang, onPopupLangChange, langFlagsHtml } from '../utils/popupLang.js';

const TEXT = {
    en: {
        title: 'Privacy & Analytics',
        body: [
            'This site respects your privacy. We do not store IP addresses and we do not use tracking cookies. The site is hosted and operated via third-party hosting and cloud providers used to deliver the content over the web.',
            "We use your device's local storage solely to save your display preferences and to speed up loading of the league data.",
            'To understand how the site is used we collect anonymous statistics: for local visitors, the site uses temporary in-browser memory (cleared the moment you leave the site) to understand the current browsing sequence. For visitors from the rest of the world, general usage data is recorded as individual events without any use of device memory.',
        ],
        close: 'Close',
    },
    he: {
        title: 'פרטיות ואנליטיקה באתר',
        body: [
            'אתר זה מכבד את פרטיותך. איננו שומרים כתובות IP ואיננו משתמשים בעוגיות מעקב (Cookies). האתר מתארח ומופעל באמצעות ספקי תשתיות אירוח וענן חיצוניים המשמשים להצגת התוכן ברשת.',
            'אנו משתמשים באחסון המקומי של מכשירך אך ורק כדי לשמור את העדפות התצוגה שלך ולשפר את מהירות הטעינה של נתוני הליגה.',
            'כדי להבין את רמת השימוש באתר אנו אוספים סטטיסטיקה אנונימית: עבור מבקרים מקומיים, האתר נעזר בזיכרון זמני בדפדפן (אשר נמחק מיד עם עזיבת האתר) כדי להבין את רצף הגלישה הנוכחי. עבור מבקרים משאר העולם, נרשמים נתוני שימוש כלליים כאירועים בודדים ללא כל שימוש בזיכרון המכשיר.',
        ],
        close: 'סגור',
    },
};

let overlayEl = null; // built lazily on first open

function injectStylesOnce() {
    if (document.getElementById('privacy-notice-styles')) return;
    const style = document.createElement('style');
    style.id = 'privacy-notice-styles';
    style.textContent = `
        .privacy-overlay {
            position: fixed; inset: 0; z-index: 4000;
            display: flex; align-items: center; justify-content: center;
            padding: 1rem; background: rgba(0,0,0,.55);
        }
        .privacy-overlay[hidden] { display: none; }
        .privacy-modal {
            position: relative;
            background: var(--color-surface, var(--color-bg, #fff));
            color: var(--color-text, #111);
            border: 1px solid var(--color-border, #ccc);
            max-width: 34rem; width: 100%; max-height: 85vh; overflow-y: auto;
            border-radius: 14px; padding: 1.5rem 1.6rem;
            box-shadow: 0 20px 60px rgba(0,0,0,.4);
            font-size: .95rem; line-height: 1.6;
        }
        /* × close in the top-right corner — same convention as the info
           popups' .predictor-info-close (dashboard.css). */
        .privacy-modal-close-x {
            position: absolute; top: .5rem; right: .7rem;
            background: none; border: none; padding: 0;
            font-size: 1.5rem; line-height: 1; cursor: pointer;
            color: var(--color-text-muted, #888);
        }
        .privacy-modal-close-x:hover { color: var(--color-text, #111); }
        /* Flags in their OWN bar at the top (canonical .popup-lang-flags-bar
           pattern) so they never collide with the top-right ×. Markup from
           popupLang.langFlagsHtml(). Force LTR/left so an ambient RTL context
           (Hebrew page/browser) can't push the flags onto the × — the × is
           physically pinned right, the flags physically left, in every locale. */
        /* Only position the BAR (left-aligned, LTR so an RTL page can't push
           the flags onto the ×). The flag buttons themselves are left to the
           canonical .popup-lang-flag styling in dashboard.css — circular, no
           box — so they look identical to the info-popup flags. Overriding
           them here is what put a square behind the flags. */
        .privacy-modal .popup-lang-flags-bar {
            margin-bottom: .7rem; direction: ltr; text-align: left;
        }
        .privacy-modal-title {
            margin: 0 0 .8rem; font-size: 1.15rem; font-weight: 700;
            color: var(--color-text, #111); padding-right: 1.4rem;
        }
        .privacy-modal p { margin: 0 0 .8rem; }
        .privacy-modal p:last-of-type { margin-bottom: 0; }
        /* RTL applies to the reading content only — NOT the whole modal — so the
           × (top-right) and flags bar (top-left) keep their sides in Hebrew. */
        .privacy-modal[data-lang="he"] .privacy-modal-title,
        .privacy-modal[data-lang="he"] .privacy-modal-body { direction: rtl; text-align: right; }
    `;
    document.head.appendChild(style);
}

function render(lang) {
    const t = TEXT[lang] || TEXT.en;
    const modal = overlayEl.querySelector('.privacy-modal');
    modal.dataset.lang = lang;
    overlayEl.querySelector('.privacy-modal-title').textContent = t.title;
    // Build empty <p> shells, then fill via textContent (never inject the
    // strings as HTML).
    const bodyEl = overlayEl.querySelector('.privacy-modal-body');
    bodyEl.innerHTML = t.body.map(() => '<p></p>').join('');
    bodyEl.querySelectorAll('p').forEach((p, i) => { p.textContent = t.body[i]; });
    overlayEl.querySelector('.privacy-modal-close-x').setAttribute('aria-label', t.close);
    overlayEl.querySelectorAll('.popup-lang-flag').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.lang === lang);
    });
}

function build() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'privacy-overlay';
    overlayEl.hidden = true;
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.innerHTML = `
        <div class="privacy-modal" data-lang="en">
            <button type="button" class="privacy-modal-close-x" aria-label="Close">&times;</button>
            <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
            <h2 class="privacy-modal-title"></h2>
            <div class="privacy-modal-body"></div>
        </div>`;
    document.body.appendChild(overlayEl);

    // Close on backdrop click, × button, or Escape.
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl || e.target.closest('.privacy-modal-close-x')) close();
    });
    overlayEl.querySelectorAll('.popup-lang-flag').forEach((b) => {
        b.addEventListener('click', () => setPopupLang(b.dataset.lang));
    });
    onPopupLangChange((lang) => { if (!overlayEl.hidden) render(lang); });

    render(getPopupLang());
}

function open() {
    if (!overlayEl) build();
    render(getPopupLang());
    overlayEl.hidden = false;
    // Capture phase so we intercept Escape BEFORE the global keyboard handler
    // in navigation.js (which otherwise fires history.back() and navigates
    // away instead of just closing the modal).
    document.addEventListener('keydown', onKeydown, true);
}

function close() {
    if (overlayEl) overlayEl.hidden = true;
    document.removeEventListener('keydown', onKeydown, true);
}

function onKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation(); // don't let navigation.js's Escape → history.back() also fire
        close();
    }
}

// Inject styles eagerly (the sidebar link needs them at load; the modal
// itself is still built lazily on first open).
injectStylesOnce();

// One delegated listener for every current/future [data-action="privacy"]
// trigger — added once at import.
document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="privacy"]')) {
        e.preventDefault();
        open();
    }
});
