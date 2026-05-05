/**
 * themePicker.js — drop-in theme picker (8 themes + 6-role customize panel).
 *
 * Usage:
 *   import { initThemePicker } from './themePicker.js';
 *   initThemePicker({ appKey: 'myapp' });
 *   // or attach to an existing button:
 *   initThemePicker({ appKey: 'myapp', trigger: document.querySelector('#theme-btn') });
 *
 * Persists to localStorage under `${appKey}-theme` and `${appKey}-custom-vars`.
 * Pair with the FOUC bootstrap in <head> using the same appKey.
 */

const THEMES = [
    { id: 'current', label: 'Standard' },
    { id: 'dark',    label: 'Dark' },
    { id: 'beige',   label: 'Beige' },
    { id: 'nature',  label: 'Nature' },
    { id: 'vegas',   label: 'Las Vegas' },
    { id: 'casino',  label: 'Casino' },
    { id: 'rainbow', label: 'Rainbow' },
    { id: 'x22',     label: 'X22' },
];

const CUSTOMIZABLE_VARS = [
    { key: '--color-bg',      label: 'Background' },
    { key: '--color-surface', label: 'Surface' },
    { key: '--color-text',    label: 'Text' },
    { key: '--color-accent',  label: 'Accent' },
    { key: '--header-bg',     label: 'Header BG' },
    { key: '--header-text',   label: 'Header Text' },
];

export function initThemePicker({ appKey = 'app', trigger = null } = {}) {
    const STORAGE_KEY = `${appKey}-theme`;
    const CUSTOM_VARS_KEY = `${appKey}-custom-vars`;

    const getTheme = () => localStorage.getItem(STORAGE_KEY) || 'current';

    const setTheme = (t) => {
        if (t === 'current') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = t;
        localStorage.setItem(STORAGE_KEY, t);
        clearCustomVars();
        syncIframes();
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
    };

    const clearCustomVars = () => {
        try {
            const v = JSON.parse(localStorage.getItem(CUSTOM_VARS_KEY) || '{}');
            Object.keys(v).forEach(k => document.documentElement.style.removeProperty(k));
        } catch {}
        localStorage.removeItem(CUSTOM_VARS_KEY);
    };

    const applyCustomVars = () => {
        try {
            const v = JSON.parse(localStorage.getItem(CUSTOM_VARS_KEY) || '{}');
            Object.entries(v).forEach(([k, val]) =>
                document.documentElement.style.setProperty(k, val));
        } catch {}
    };

    const saveCustomVar = (k, val) => {
        let v = {};
        try { v = JSON.parse(localStorage.getItem(CUSTOM_VARS_KEY) || '{}'); } catch {}
        v[k] = val;
        localStorage.setItem(CUSTOM_VARS_KEY, JSON.stringify(v));
        document.documentElement.style.setProperty(k, val);
        syncIframes();
    };

    const syncIframes = () => {
        const t = getTheme();
        const customRaw = localStorage.getItem(CUSTOM_VARS_KEY);
        for (const f of document.querySelectorAll('iframe')) {
            try {
                const doc = f.contentDocument; if (!doc) continue;
                if (t === 'current') delete doc.documentElement.dataset.theme;
                else doc.documentElement.dataset.theme = t;
                CUSTOMIZABLE_VARS.forEach(v =>
                    doc.documentElement.style.removeProperty(v.key));
                if (customRaw) {
                    const cv = JSON.parse(customRaw);
                    Object.entries(cv).forEach(([k, val]) =>
                        doc.documentElement.style.setProperty(k, val));
                }
            } catch {}
        }
    };

    const computedVar = (k) =>
        getComputedStyle(document.documentElement).getPropertyValue(k).trim();

    const toHex = (rgb) => {
        if (rgb.startsWith('#')) return rgb.length === 4 || rgb.length === 7 ? rgb : rgb.slice(0, 7);
        const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
        return m
            ? '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('')
            : '#000000';
    };

    applyCustomVars();

    const root = document.createElement('div');
    root.className = 'theme-picker';

    const panel = document.createElement('div');
    panel.className = 'theme-picker-panel';
    panel.hidden = true;

    const lbl = document.createElement('div');
    lbl.className = 'theme-picker-label';
    lbl.textContent = 'Theme';
    panel.appendChild(lbl);

    const row = document.createElement('div');
    row.className = 'theme-picker-options';
    const active = getTheme();

    THEMES.forEach(t => {
        const b = document.createElement('button');
        b.className = `theme-swatch swatch-${t.id}` + (t.id === active ? ' active' : '');
        b.title = t.label;
        b.setAttribute('aria-label', `${t.label} theme`);
        b.addEventListener('click', () => {
            setTheme(t.id);
            row.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
            b.classList.add('active');
            refreshInputs();
        });
        row.appendChild(b);
    });
    panel.appendChild(row);

    const divider = document.createElement('div');
    divider.className = 'theme-picker-divider';
    panel.appendChild(divider);

    const customBtn = document.createElement('button');
    customBtn.className = 'theme-customize-btn';
    customBtn.textContent = 'Customize';
    panel.appendChild(customBtn);

    const customPanel = document.createElement('div');
    customPanel.className = 'theme-customize-panel';
    customPanel.hidden = true;

    const inputs = [];
    CUSTOMIZABLE_VARS.forEach(v => {
        const r = document.createElement('div');
        r.className = 'theme-color-row';
        const l = document.createElement('label');
        l.textContent = v.label;
        const i = document.createElement('input');
        i.type = 'color';
        i.dataset.varKey = v.key;
        i.value = toHex(computedVar(v.key));
        i.addEventListener('input', () => saveCustomVar(v.key, i.value));
        inputs.push(i);
        r.appendChild(l); r.appendChild(i);
        customPanel.appendChild(r);
    });

    const reset = document.createElement('button');
    reset.className = 'theme-reset-btn';
    reset.textContent = 'Reset to theme defaults';
    reset.addEventListener('click', () => { clearCustomVars(); refreshInputs(); });
    customPanel.appendChild(reset);
    panel.appendChild(customPanel);

    customBtn.addEventListener('click', () => {
        customPanel.hidden = !customPanel.hidden;
        if (!customPanel.hidden) refreshInputs();
    });

    function refreshInputs() {
        inputs.forEach(i => { i.value = toHex(computedVar(i.dataset.varKey)); });
    }

    let triggerEl = trigger;
    if (!triggerEl) {
        triggerEl = document.createElement('button');
        triggerEl.className = 'theme-picker-toggle';
        triggerEl.setAttribute('aria-label', 'Change theme');
        triggerEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
        root.appendChild(triggerEl);
    }
    triggerEl.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) refreshInputs();
    });

    document.addEventListener('click', (e) => {
        if (!root.contains(e.target) && e.target !== triggerEl) panel.hidden = true;
    });

    root.appendChild(panel);
    document.body.appendChild(root);
}
