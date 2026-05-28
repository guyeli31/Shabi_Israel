// components/ThemePicker/themePicker.js — floating bottom-right theme
// switcher. Lists the 8 v2 themes; persists choice to localStorage and
// applies via document.documentElement.dataset.theme.

const STORAGE_KEY = "shabi-theme";

const THEMES = [
    { id: "default", label: "Standard" },
    { id: "dark",    label: "Dark" },
    { id: "beige",   label: "Beige" },
    { id: "nature",  label: "Nature" },
    { id: "vegas",   label: "Las Vegas" },
    { id: "casino",  label: "Casino" },
    { id: "rainbow", label: "Rainbow" },
    { id: "x22",     label: "X22" },
];

export function getActiveTheme() {
    try { return localStorage.getItem(STORAGE_KEY) || "default"; }
    catch (e) { return "default"; }
}

export function applyTheme(themeId) {
    if (themeId === "default") {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = themeId;
    }
    try { localStorage.setItem(STORAGE_KEY, themeId); }
    catch (e) { /* ignore */ }
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: themeId } }));
}

/**
 * @returns {HTMLDivElement}
 */
export function render() {
    const picker = document.createElement("div");
    picker.className = "theme-picker";

    const toggle = document.createElement("button");
    toggle.className = "theme-picker__toggle";
    toggle.setAttribute("aria-label", "Change theme");
    toggle.innerHTML = sunIcon();

    const panel = document.createElement("div");
    panel.className = "theme-picker__panel";
    panel.hidden = true;

    const label = document.createElement("div");
    label.className = "theme-picker__label";
    label.textContent = "Theme";
    panel.appendChild(label);

    const options = document.createElement("div");
    options.className = "theme-picker__options";
    const active = getActiveTheme();

    for (const theme of THEMES) {
        const btn = document.createElement("button");
        btn.className = "theme-picker__swatch";
        btn.dataset.theme = theme.id;
        btn.title = theme.label;
        btn.setAttribute("aria-label", `${theme.label} theme`);
        btn.setAttribute("aria-pressed", String(theme.id === active));

        btn.addEventListener("click", () => {
            applyTheme(theme.id);
            for (const s of options.querySelectorAll("[data-theme]")) {
                s.setAttribute("aria-pressed", String(s.dataset.theme === theme.id));
            }
        });
        options.appendChild(btn);
    }
    panel.appendChild(options);

    toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
    });
    document.addEventListener("click", (e) => {
        if (!picker.contains(e.target)) panel.hidden = true;
    });

    picker.append(panel, toggle);
    return picker;
}

function sunIcon() {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
}
