/**
 * themePicker.js — Floating theme picker with 5 themes + Customize panel.
 * Persists selection to localStorage, applies via data-theme attribute on <html>.
 */

const STORAGE_KEY = 'shabi-theme';
const CUSTOM_VARS_KEY = 'shabi-custom-vars';

const THEMES = [
    { id: 'current', label: 'Current' },
    { id: 'dark',    label: 'Dark' },
    { id: 'beige',   label: 'Beige' },
    { id: 'modern',  label: 'Modern' },
    { id: 'royal',   label: 'Royal' }
];

const CUSTOMIZABLE_VARS = [
    { key: '--color-bg',      label: 'Background' },
    { key: '--color-surface',  label: 'Surface' },
    { key: '--color-text',     label: 'Text' },
    { key: '--color-accent',   label: 'Accent' },
    { key: '--header-bg',      label: 'Header BG' },
    { key: '--header-text',    label: 'Header Text' }
];

function getActiveTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'current';
}

function applyTheme(themeId) {
    if (themeId === 'current') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = themeId;
    }
    localStorage.setItem(STORAGE_KEY, themeId);
    clearCustomVars();
}

function clearCustomVars() {
    const saved = localStorage.getItem(CUSTOM_VARS_KEY);
    if (saved) {
        try {
            const vars = JSON.parse(saved);
            for (const key of Object.keys(vars)) {
                document.documentElement.style.removeProperty(key);
            }
        } catch (e) { /* ignore */ }
    }
    localStorage.removeItem(CUSTOM_VARS_KEY);
}

function applyCustomVars() {
    const saved = localStorage.getItem(CUSTOM_VARS_KEY);
    if (!saved) return;
    try {
        const vars = JSON.parse(saved);
        for (const [key, value] of Object.entries(vars)) {
            document.documentElement.style.setProperty(key, value);
        }
    } catch (e) { /* ignore */ }
}

function saveCustomVar(key, value) {
    let vars = {};
    try { vars = JSON.parse(localStorage.getItem(CUSTOM_VARS_KEY) || '{}'); } catch (e) { /* ignore */ }
    vars[key] = value;
    localStorage.setItem(CUSTOM_VARS_KEY, JSON.stringify(vars));
    document.documentElement.style.setProperty(key, value);
}

function getComputedVar(key) {
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
}

function rgbToHex(rgb) {
    if (rgb.startsWith('#')) return rgb.length === 4 || rgb.length === 7 ? rgb : rgb.slice(0, 7);
    const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return '#000000';
    const [, r, g, b] = match;
    return '#' + [r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

export function initThemePicker() {
    // Apply custom vars if any (the FOUC script handles theme attribute,
    // but custom vars need to be applied after CSS loads)
    applyCustomVars();

    // Build DOM
    const picker = document.createElement('div');
    picker.className = 'theme-picker';

    const toggle = document.createElement('button');
    toggle.className = 'theme-picker-toggle';
    toggle.setAttribute('aria-label', 'Change theme');
    toggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';

    const panel = document.createElement('div');
    panel.className = 'theme-picker-panel';
    panel.hidden = true;

    // Label
    const label = document.createElement('div');
    label.className = 'theme-picker-label';
    label.textContent = 'Theme';
    panel.appendChild(label);

    // Swatches
    const swatchRow = document.createElement('div');
    swatchRow.className = 'theme-picker-options';

    const activeTheme = getActiveTheme();

    for (const theme of THEMES) {
        const btn = document.createElement('button');
        btn.className = `theme-swatch swatch-${theme.id}`;
        if (theme.id === activeTheme) btn.classList.add('active');
        btn.setAttribute('title', theme.label);
        btn.setAttribute('aria-label', `${theme.label} theme`);

        btn.addEventListener('click', () => {
            applyTheme(theme.id);
            swatchRow.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            updateColorInputs();
        });

        swatchRow.appendChild(btn);
    }
    panel.appendChild(swatchRow);

    // Divider
    const divider = document.createElement('div');
    divider.className = 'theme-picker-divider';
    panel.appendChild(divider);

    // Customize button
    const customizeBtn = document.createElement('button');
    customizeBtn.className = 'theme-customize-btn';
    customizeBtn.textContent = 'Customize';
    panel.appendChild(customizeBtn);

    // Customize panel
    const customPanel = document.createElement('div');
    customPanel.className = 'theme-customize-panel';
    customPanel.hidden = true;

    const colorInputs = [];

    for (const v of CUSTOMIZABLE_VARS) {
        const row = document.createElement('div');
        row.className = 'theme-color-row';

        const lbl = document.createElement('label');
        lbl.textContent = v.label;

        const input = document.createElement('input');
        input.type = 'color';
        input.dataset.varKey = v.key;
        input.value = rgbToHex(getComputedVar(v.key));

        input.addEventListener('input', () => {
            saveCustomVar(v.key, input.value);
        });

        colorInputs.push(input);
        row.appendChild(lbl);
        row.appendChild(input);
        customPanel.appendChild(row);
    }

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'theme-reset-btn';
    resetBtn.textContent = 'Reset to theme defaults';
    resetBtn.addEventListener('click', () => {
        clearCustomVars();
        updateColorInputs();
    });
    customPanel.appendChild(resetBtn);

    panel.appendChild(customPanel);

    // Toggle panel
    toggle.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) updateColorInputs();
    });

    // Toggle customize
    customizeBtn.addEventListener('click', () => {
        customPanel.hidden = !customPanel.hidden;
        if (!customPanel.hidden) updateColorInputs();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) {
            panel.hidden = true;
        }
    });

    function updateColorInputs() {
        for (const input of colorInputs) {
            input.value = rgbToHex(getComputedVar(input.dataset.varKey));
        }
    }

    picker.appendChild(panel);
    picker.appendChild(toggle);
    document.body.appendChild(picker);
}
