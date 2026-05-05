# Theme System — Portable Spec

A single, drop-in specification for the multi-theme + customization system used in Shabi Israel, written so it can be lifted into any other web project (apps, dashboards, tools — not necessarily websites).

The file is split in three layers, each independent of the others:

1. **Role taxonomy** — semantic names for color slots (background, surface, accent, header, etc.). Themes are mappings *from these roles to concrete colors*. The consuming app maps *from these roles to its own UI entities*.
2. **The 8 themes** — full palettes, one row per role.
3. **The picker UX** — the menu that lets the user switch theme + override individual roles, plus a reference HTML/CSS/JS implementation. The trigger button (a floating circle here) is *not* part of the spec — every host app picks its own trigger.

---

## 1. Role Taxonomy

A theme is *not* a list of colors — it is a list of **roles** that the host app maps to its UI. Apps with fewer entities reuse the same role for several entities. Apps with more entities derive new colors from these (e.g., tinting `--color-accent`).

### 1.1 Required roles (every theme defines all of these)

These are the minimum viable theme. If your app only honors these eight, every theme will still look correct.

| Role | What it represents | Typical UI entities |
|------|---|---|
| `--color-bg` | Page / app background | `<body>`, app shell |
| `--color-surface` | Raised content surface | Cards, tables, panels, modals |
| `--color-text` | Primary text | Body copy, headings (h1-h6) |
| `--color-text-secondary` | De-emphasized text | Subtitles, captions, helper text |
| `--color-text-muted` | Disabled / hint text | Placeholders, "no data", timestamps |
| `--color-border` | Hairline separators | Card edges, table borders, dividers |
| `--color-accent` | Brand / interactive | Links, primary buttons, focus rings, active state |
| `--color-accent-light` | Accent on backgrounds | Hover tints, selected-row tint, badge fills |

### 1.2 Recommended roles (defined by every theme here, but optional in your app)

| Role | What it represents | Typical UI entities |
|------|---|---|
| `--color-hover` | Generic hover surface | Row hover, button hover-bg |
| `--header-bg` | Strong banded surface | Top app bar, table headers, sticky toolbars |
| `--header-text` | Text on `--header-bg` | Logo wordmark, header links |
| `--header-bg-hover` | `--header-bg` on hover | Sortable column header hover |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` | Depth | Cards, popovers, modals |

### 1.3 Semantic feedback roles (state, not branding)

Use these for *meaning*, never decoration.

| Role | Meaning | Example |
|------|---|---|
| `--color-win` / `--color-running` | Success, positive | "Online" pill, win cell, ✓ icon |
| `--color-loss` | Error, negative | "Failed" pill, loss cell, ✗ icon |
| `--color-draw` / `--color-completed` | Neutral, finished | "Done" pill, draw cell, archived |
| `--color-running-bg`, `--color-completed-bg` | Soft surface for the above | Pill backgrounds |

### 1.4 Decorative awards (optional — only if your app has rankings)

A three-tier award scale (gold > silver > bronze). Most non-game apps omit these and reuse `--color-accent` for any "highlight first row" needs.

| Role | Color | Background | Text on bg | Hover-bg |
|------|---|---|---|---|
| Gold | `--color-gold` | `--color-gold-bg` | `--color-gold-text` | `--color-gold-bg-hover` |
| Silver | `--color-silver` | `--color-silver-bg` | `--color-silver-text` | `--color-silver-bg-hover` |
| Bronze | `--color-bronze` | `--color-bronze-bg` | `--color-bronze-text` | `--color-bronze-bg-hover` |

### 1.5 Chart roles (optional — only if your app draws canvas/SVG charts)

| Role | Use |
|------|---|
| `--chart-grid` | Gridlines |
| `--chart-axis` | Axis lines, ticks |
| `--chart-label` | Axis & legend text |
| `--chart-hover-outline` | Hovered point/bar outline |

---

## 2. The 8 Themes

Themes are activated by setting `data-theme="<id>"` on the `<html>` element. The default theme has *no* attribute — it lives on `:root`.

### 2.1 Theme IDs and pitch

| ID | Display name | Vibe | When to suggest it |
|------|---|---|---|
| `current` (default) | Standard | Clean light, blue accent | Default for productivity / data apps |
| `dark` | Dark | Modern dark with cool blue | Long sessions, low-light environments |
| `beige` | Beige | Warm paper / book | Reading-heavy apps, archives |
| `nature` | Nature | Green forest, sunny | Wellness, outdoor, organic brands |
| `vegas` | Las Vegas | Casino felt + gold | Gaming, gambling, entertainment |
| `casino` | Casino | Vivid red + gold | High-energy gaming variants |
| `rainbow` | Rainbow | Pastel multi-color | Children, creative, playful tools |
| `x22` | X22 | Backgammon board | Niche/themed (kept for inspiration) |

### 2.2 Full palettes

Each block below is a CSS custom-property map. Copy as-is — no transformation needed.

#### `current` (default — no `data-theme` attribute)

```css
:root {
    /* Surface */
    --color-bg: #f0f2f5;
    --color-surface: #ffffff;
    --color-hover: #f5f6f8;
    --color-border: #e2e4e9;
    /* Text */
    --color-text: #1a1a2e;
    --color-text-secondary: #52546b;
    --color-text-muted: #6b6d84;
    /* Brand */
    --color-accent: #2563eb;
    --color-accent-light: #dbeafe;
    /* Header */
    --header-bg: #1e293b;
    --header-text: #f8fafc;
    --header-bg-hover: #334155;
    /* Feedback */
    --color-win: #047857;
    --color-loss: #b91c1c;
    --color-draw: #4b5563;
    --color-running: #047857;
    --color-running-bg: #d1fae5;
    --color-completed: #4b5563;
    --color-completed-bg: #f3f4f6;
    /* Awards */
    --color-gold: #fbbf24;       --color-gold-bg: #fef3c7;       --color-gold-text: #78350f;
    --color-silver: #9ca3af;     --color-silver-bg: #f3f4f6;     --color-silver-text: #1f2937;
    --color-bronze: #d97706;     --color-bronze-bg: #fde8c8;     --color-bronze-text: #78350f;
    /* Shadow */
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
    /* Chart */
    --chart-grid: rgba(0,0,0,0.18);
    --chart-axis: rgba(0,0,0,0.35);
    --chart-label: rgba(0,0,0,0.65);
    --chart-hover-outline: #000000;
}
```

#### `dark`

```css
[data-theme="dark"] {
    --color-bg: #1c1c26;          --color-surface: #262633;
    --color-hover: #2f2f3f;       --color-border: #3a3a4d;
    --color-text: #ececf1;        --color-text-secondary: #c5c9d8;  --color-text-muted: #9ea2b5;
    --color-accent: #6ba8ff;      --color-accent-light: #1e3a5f;
    --header-bg: #14141e;         --header-text: #ececf1;           --header-bg-hover: #22222e;
    --color-win: #34d399;         --color-loss: #f87171;            --color-draw: #9ca3af;
    --color-running: #34d399;     --color-running-bg: #0f2e22;
    --color-completed: #9ca3af;   --color-completed-bg: #2f2f3f;
    --color-gold: #fbbf24;        --color-gold-bg: #5a4a14;         --color-gold-text: #ffe27a;
    --color-silver: #c9cfde;      --color-silver-bg: #3a3f52;       --color-silver-text: #e8ecf5;
    --color-bronze: #d97706;      --color-bronze-bg: #4a2f12;       --color-bronze-text: #ffb87a;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.30);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.40);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.50);
    --chart-grid: rgba(255,255,255,0.10);   --chart-axis: rgba(255,255,255,0.30);
    --chart-label: rgba(236,236,241,0.75);  --chart-hover-outline: #ffffff;
}
```

#### `beige`

```css
[data-theme="beige"] {
    --color-bg: #f5efe6;          --color-surface: #fdf8f0;
    --color-hover: #f0e6d8;       --color-border: #e0d4c4;
    --color-text: #3e2c1c;        --color-text-secondary: #5a4436;  --color-text-muted: #7a6654;
    --color-accent: #8b5e3c;      --color-accent-light: #f0e0cc;
    --header-bg: #4a3428;         --header-text: #f5efe6;           --header-bg-hover: #5c4438;
    --color-win: #3a6e46;         --color-loss: #9b2e22;            --color-draw: #5c5144;
    --color-running: #3a6e46;     --color-running-bg: #dceede;
    --color-completed: #5c5144;   --color-completed-bg: #ede7dd;
    --color-gold: #d4a017;        --color-gold-bg: #f5ecd0;         --color-gold-text: #6b4e0a;
    --color-silver: #8a7e6e;      --color-silver-bg: #ede7dd;       --color-silver-text: #3e2c1c;
    --color-bronze: #b5651d;      --color-bronze-bg: #f5e8d0;       --color-bronze-text: #5a3408;
}
```

#### `nature`

```css
[data-theme="nature"] {
    --color-bg: #eaf5e1;          --color-surface: #ffffff;
    --color-hover: #dcefcf;       --color-border: #c3dfae;
    --color-text: #1f3a1a;        --color-text-secondary: #3d5a2f;  --color-text-muted: #5e7548;
    --color-accent: #2e6b31;      --color-accent-light: #d9efc4;
    --header-bg: #1f3f1c;         --header-text: #f5c518;           --header-bg-hover: #2a5426;
    --color-win: #2e6b31;         --color-loss: #9c2e22;            --color-draw: #5e7548;
    --color-running: #2e6b31;     --color-running-bg: #d9efc4;
    --color-completed: #5e7548;   --color-completed-bg: #e3efd5;
    --color-gold: #f5c518;        --color-gold-bg: #fff4c2;         --color-gold-text: #6b5300;
    --color-silver: #8aa57a;      --color-silver-bg: #e3efd5;       --color-silver-text: #2f4a25;
    --color-bronze: #b8702a;      --color-bronze-bg: #f3dfc0;       --color-bronze-text: #5a3408;
    --shadow-sm: 0 1px 2px rgba(31,58,26,0.08);
    --shadow-md: 0 4px 12px rgba(31,58,26,0.12);
    --shadow-lg: 0 8px 30px rgba(31,58,26,0.15);
    --chart-grid: rgba(31,58,26,0.10);    --chart-axis: rgba(31,58,26,0.35);
    --chart-label: rgba(31,58,26,0.70);   --chart-hover-outline: #1f3a1a;
}
```

#### `vegas`

```css
[data-theme="vegas"] {
    --color-bg: #0a0d0a;          --color-surface: #14281a;
    --color-hover: #1c3624;       --color-border: #2a4a32;
    --color-text: #f8e9c4;        --color-text-secondary: #d4af37;  --color-text-muted: #b09a62;
    --color-accent: #e8c252;      --color-accent-light: #3a2f10;
    --header-bg: #4a0a0a;         --header-text: #f5d76e;           --header-bg-hover: #5e1414;
    --color-win: #2ecc71;         --color-loss: #e74c3c;            --color-draw: #c4a14a;
    --color-running: #2ecc71;     --color-running-bg: #103a20;
    --color-completed: #9a8a5a;   --color-completed-bg: #1c2418;
    --color-gold: #f5d76e;        --color-gold-bg: #4a3a10;         --color-gold-text: #ffe98a;
    --color-silver: #d0d4de;      --color-silver-bg: #2a3340;       --color-silver-text: #eef2fa;
    --color-bronze: #d97a32;      --color-bronze-bg: #3e2410;       --color-bronze-text: #ffb87a;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.40);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.50);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.60);
    --chart-grid: rgba(245,215,110,0.12); --chart-axis: rgba(245,215,110,0.35);
    --chart-label: rgba(248,233,196,0.75); --chart-hover-outline: #f5d76e;
}
```

#### `casino`

```css
[data-theme="casino"] {
    --color-bg: #1a0a0a;          --color-surface: #2c1414;
    --color-hover: #3a1a1a;       --color-border: #5a2020;
    --color-text: #fff8e7;        --color-text-secondary: #ffd700;  --color-text-muted: #c9a84c;
    --color-accent: #ffd700;      --color-accent-light: #4a3000;
    --header-bg: #8b0000;         --header-text: #ffd700;           --header-bg-hover: #a01010;
    --color-win: #00e676;         --color-loss: #ff1744;            --color-draw: #ffd700;
    --color-running: #00e676;     --color-running-bg: #0a2a14;
    --color-completed: #c9a84c;   --color-completed-bg: #2a1a0a;
    --color-gold: #ffd700;        --color-gold-bg: #5c4a00;         --color-gold-text: #ffe44d;
    --color-silver: #c0c0c0;      --color-silver-bg: #3a3a4a;       --color-silver-text: #e8e8f0;
    --color-bronze: #cd7f32;      --color-bronze-bg: #4a2800;       --color-bronze-text: #ffb366;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.40);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.50);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.60);
    --chart-grid: rgba(255,215,0,0.15);   --chart-axis: rgba(255,215,0,0.40);
    --chart-label: rgba(255,248,231,0.80); --chart-hover-outline: #ffd700;
}
```

#### `rainbow`

```css
[data-theme="rainbow"] {
    --color-bg: #fff5f5;          --color-surface: #ffffff;
    --color-hover: #fce4ec;       --color-border: #e8d5f5;
    --color-text: #2d1b69;        --color-text-secondary: #5a3f90;  --color-text-muted: #645385;
    --color-accent: #c2185b;      --color-accent-light: #fce4ec;
    --header-bg: #5e35e0;         --header-text: #ffffff;           --header-bg-hover: #4a22c0;
    --color-win: #007a33;         --color-loss: #c7143a;            --color-draw: #b35a00;
    --color-running: #007a33;     --color-running-bg: #e8f5e9;
    --color-completed: #8e24a3;   --color-completed-bg: #f3e5f5;
    --color-gold: #ffd600;        --color-gold-bg: #fff9c4;         --color-gold-text: #6b5b00;
    --color-silver: #ab47bc;      --color-silver-bg: #f3e5f5;       --color-silver-text: #4a148c;
    --color-bronze: #ff7043;      --color-bronze-bg: #fbe9e7;       --color-bronze-text: #bf360c;
    --shadow-sm: 0 1px 2px rgba(45,27,105,0.08);
    --shadow-md: 0 4px 12px rgba(45,27,105,0.12);
    --shadow-lg: 0 8px 30px rgba(45,27,105,0.15);
    --chart-grid: rgba(45,27,105,0.10);   --chart-axis: rgba(45,27,105,0.30);
    --chart-label: rgba(45,27,105,0.70);  --chart-hover-outline: #e91e63;
}
```

#### `x22`

```css
[data-theme="x22"] {
    --color-bg: #0f0f0f;          --color-surface: #181818;
    --color-hover: #1f1f1f;       --color-border: #2a2a2a;
    --color-text: #f5f5f5;        --color-text-secondary: #ffb74d;  --color-text-muted: #8a8a8a;
    --color-accent: #ff9800;      --color-accent-light: #1a2e1a;
    --header-bg: #1b3a1b;         --header-text: #ffffff;           --header-bg-hover: #255025;
    --color-win: #4caf50;         --color-loss: #e07070;            --color-draw: #ff9800;
    --color-running: #4caf50;     --color-running-bg: #11241a;
    --color-completed: #9e9e9e;   --color-completed-bg: #1f1f1f;
    --color-gold: #ff9800;        --color-gold-bg: #3a2608;         --color-gold-text: #ffc266;
    --color-silver: #cfcfcf;      --color-silver-bg: #2a2a2a;       --color-silver-text: #eaeaea;
    --color-bronze: #4caf50;      --color-bronze-bg: #15321a;       --color-bronze-text: #8be28f;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.40);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.50);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.60);
    --chart-grid: rgba(255,255,255,0.10); --chart-axis: rgba(255,255,255,0.30);
    --chart-label: rgba(245,245,245,0.75); --chart-hover-outline: #ff9800;
}
```

### 2.3 Theme swatches (the 2-tone disc shown in the picker)

Each theme has a fixed swatch — half background-color, half accent — so the user previews the vibe before clicking. These do **not** depend on the active theme.

| Theme | Swatch (background) |
|------|---|
| `current` | `linear-gradient(135deg, #f0f2f5 50%, #2563eb 50%)` |
| `dark` | `linear-gradient(135deg, #1c1c26 50%, #6ba8ff 50%)` |
| `beige` | `linear-gradient(135deg, #f5efe6 50%, #8b5e3c 50%)` |
| `nature` | `linear-gradient(135deg, #eaf5e1 50%, #3d8b40 50%)` |
| `vegas` | `linear-gradient(135deg, #14281a 50%, #f5d76e 50%)` |
| `casino` | `linear-gradient(135deg, #8b0000 50%, #ffd700 50%)` |
| `rainbow` | `linear-gradient(135deg, #fce4ec 50%, #7c4dff 50%)` |
| `x22` | conic gradient (see picker CSS below) |

---

## 3. Adapting Themes to Your App

The themes were authored for an app with these UI entities:

> page, cards, table headers, sortable columns, ranked rows (medal tiers), status pills, average/footer rows, hover states.

Your app probably has fewer or different entities. Map them as follows.

### 3.1 The "minimum viable" mapping

If your app has only **page + content + buttons + maybe one accent**, this is sufficient:

| Your entity | Map to role |
|------|---|
| Page background | `--color-bg` |
| Content area / cards | `--color-surface` |
| Body text | `--color-text` |
| Secondary text (captions, timestamps) | `--color-text-secondary` |
| Disabled / placeholders | `--color-text-muted` |
| Borders, dividers | `--color-border` |
| Primary button bg / link | `--color-accent` |
| Primary button text | `--header-text` *or* contrast-pick from `--color-bg` |
| Button/row hover | `--color-hover` |
| Top app bar / nav | `--header-bg` + `--header-text` |

Eight roles cover roughly 90% of typical app surfaces. Themes will look correct.

### 3.2 What to do when you have *more* entities than roles

> "I have 5 different button styles and 3 chart series — the spec only gives me one accent."

Two strategies:

**(a) Derive variants from `--color-accent`** at use-site, with `color-mix()` or alpha:

```css
.btn-secondary { background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)); }
.btn-ghost     { background: transparent; color: var(--color-accent); border: 1px solid var(--color-accent); }
.btn-danger    { background: var(--color-loss); }
.btn-success   { background: var(--color-win); }
.chart-series-1 { stroke: var(--color-accent); }
.chart-series-2 { stroke: var(--color-win); }
.chart-series-3 { stroke: var(--color-loss); }
.chart-series-4 { stroke: color-mix(in srgb, var(--color-accent) 60%, var(--color-text)); }
```

This stays theme-aware: every series shifts when the user switches theme.

**(b) Add app-specific roles**, but follow the same naming pattern (`--app-<role>`) and define overrides per theme. Example:

```css
:root             { --app-warning: #f59e0b; --app-warning-bg: #fef3c7; }
[data-theme="dark"]  { --app-warning: #fbbf24; --app-warning-bg: #4a3410; }
[data-theme="vegas"] { --app-warning: #e8c252; --app-warning-bg: #3a2f10; }
```

Whatever you add, define it for **every** theme, or it will look broken in the ones you forgot.

### 3.3 What to do when you have *fewer* entities than roles

Just don't reference the unused tokens. Themes still load; unused tokens are inert.

If your app has no rankings → ignore `--color-gold/silver/bronze*`.
If your app has no charts → ignore `--chart-*`.
If your app has no top bar → ignore `--header-*` and use `--color-surface` / `--color-text` for any band-of-color you need.

### 3.4 Guidance on *which* roles to honor first

Honor in this priority order. Stop wherever your app is "done."

1. `--color-bg`, `--color-surface`, `--color-text` — without these, nothing reads.
2. `--color-accent`, `--color-border` — interactive elements + structure.
3. `--color-text-secondary`, `--color-text-muted` — text hierarchy.
4. `--color-hover`, `--shadow-*` — interactivity polish.
5. `--header-bg`/`--header-text` — only if you have a banded surface.
6. `--color-win`/`--color-loss`/`--color-draw` — only if you show state.
7. Award + chart roles — only if applicable.

### 3.5 Contrast & accessibility

Each theme has been hand-tuned for contrast on its primary surfaces, but **derived colors (e.g., text on `--color-accent-light`) are your responsibility**. Two rules of thumb:

- Body text must use `--color-text` on `--color-bg`/`--color-surface`. The themes guarantee ≥4.5:1.
- Anything on `--color-accent` should use the same text color the theme uses on `--header-bg` (i.e., `--header-text`) unless the accent is bright enough that `--color-text` works (only `casino`'s gold is). When in doubt, test with WCAG.

---

## 4. The Theme Picker (Menu)

The picker is the **menu**, not the trigger. Your host app supplies its own trigger (a button in a settings modal, an icon in a top bar, a long-press, anything). The trigger's job is to toggle a single boolean: is the picker open?

### 4.1 Anatomy

```
┌─ Picker panel ────────────────────────┐
│  THEME                                │
│  ●  ●  ●  ●  ●  ●  ●  ●               ← swatch row (one per theme)
│  ───────────────────                  ← divider
│  [    Customize    ]                  ← toggles a sub-panel
│                                       │
│  ┌─ Customize sub-panel (collapsed) ┐ │
│  │ Background    [color picker]    │ │
│  │ Surface       [color picker]    │ │
│  │ Text          [color picker]    │ │
│  │ Accent        [color picker]    │ │
│  │ Header BG     [color picker]    │ │
│  │ Header Text   [color picker]    │ │
│  │ [   Reset to theme defaults   ] │ │
│  └─────────────────────────────────┘ │
└───────────────────────────────────────┘
```

### 4.2 Behavior contract

- Clicking a swatch immediately applies that theme (no Apply button).
- Active swatch is visually emphasized (border + soft halo).
- "Customize" toggles a sub-panel of `<input type="color">` for the 6 most-overridden roles. Any change applies live and persists.
- Custom overrides are **layered on top of the active theme**. Switching theme clears overrides.
- Reset clears all custom overrides; the active theme's values come back.
- Selection persists across reloads (localStorage key `<app>-theme`).
- Custom overrides persist (localStorage key `<app>-custom-vars`, JSON object).
- Clicking outside the panel closes it.
- Same-origin iframes inside the page should mirror the theme (see snippet in §5.4).

### 4.3 Customizable roles — pick six, not twenty

The customize panel intentionally exposes only a handful of roles. Exposing all 30+ is overwhelming. The defaults below are the ones with the most visual impact:

```
Background   → --color-bg
Surface      → --color-surface
Text         → --color-text
Accent       → --color-accent
Header BG    → --header-bg
Header Text  → --header-text
```

You can swap one or two of these for app-specific roles, but keep the count near 6.

---

## 5. Reference Implementation (drop-in)

Three files. Copy as-is; rename the `STORAGE_KEY` prefix to your app.

### 5.1 `themes.css` — palettes only

Paste the eight palette blocks from §2.2 verbatim. That's the entire file.

### 5.2 `theme-picker.css` — the menu's appearance (trigger-agnostic)

```css
/* Container — your host decides where it lives.
   The default is fixed bottom-right; override .theme-picker positioning if needed. */
.theme-picker {
    position: fixed;
    bottom: calc(20px + env(safe-area-inset-bottom));
    right: calc(20px + env(safe-area-inset-right));
    z-index: 1000;
    font-family: var(--font-main, system-ui, sans-serif);
}

/* Default trigger — replace freely. Just keep it as a button that opens .theme-picker-panel. */
.theme-picker-toggle {
    width: 44px; height: 44px; border-radius: 50%;
    border: 2px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text);
    cursor: pointer; font-size: 1.2rem;
    box-shadow: var(--shadow-md);
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s, box-shadow 0.15s;
}
.theme-picker-toggle:hover { transform: scale(1.1); box-shadow: var(--shadow-lg); }

/* Panel */
.theme-picker-panel {
    position: absolute; bottom: 52px; right: 0;
    background: var(--color-surface); border: 1px solid var(--color-border);
    border-radius: var(--radius-md, 10px); padding: 16px;
    box-shadow: var(--shadow-lg); min-width: 220px;
}
.theme-picker-panel[hidden] { display: none; }

/* Label */
.theme-picker-label {
    font-size: 0.8rem; font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;
}

/* Swatch row */
.theme-picker-options { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.theme-swatch {
    width: 36px; height: 36px; border-radius: 50%;
    border: 2px solid var(--color-border);
    cursor: pointer; padding: 0; outline: none;
    transition: transform 0.15s, border-color 0.15s; position: relative;
}
.theme-swatch:hover { transform: scale(1.1); }
.theme-swatch.active {
    border-color: var(--color-accent);
    transform: scale(1.15);
    box-shadow: 0 0 0 2px var(--color-accent-light);
}

/* Per-theme swatch backgrounds (FIXED — independent of active theme) */
.swatch-current { background: linear-gradient(135deg, #f0f2f5 50%, #2563eb 50%); }
.swatch-dark    { background: linear-gradient(135deg, #1c1c26 50%, #6ba8ff 50%); }
.swatch-beige   { background: linear-gradient(135deg, #f5efe6 50%, #8b5e3c 50%); }
.swatch-nature  { background: linear-gradient(135deg, #eaf5e1 50%, #3d8b40 50%); }
.swatch-vegas   { background: linear-gradient(135deg, #14281a 50%, #f5d76e 50%); }
.swatch-casino  { background: linear-gradient(135deg, #8b0000 50%, #ffd700 50%); }
.swatch-rainbow { background: linear-gradient(135deg, #fce4ec 50%, #7c4dff 50%); }
.swatch-x22 {
    background:
        conic-gradient(from 270deg at 50% 100%,
            #2e7d32 0deg 45deg,  #ff9800 45deg 90deg,
            #2e7d32 90deg 135deg, #ff9800 135deg 180deg,
            transparent 180deg 360deg),
        #0f0f0f;
}

/* Divider + Customize button */
.theme-picker-divider { height: 1px; background: var(--color-border); margin: 8px 0; }
.theme-customize-btn {
    width: 100%; padding: 6px 12px;
    border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px);
    background: var(--color-bg); color: var(--color-text-secondary);
    font-size: 0.82rem; font-weight: 600; cursor: pointer;
    transition: background 0.15s, color 0.15s;
}
.theme-customize-btn:hover { background: var(--color-hover); color: var(--color-text); }

/* Customize sub-panel */
.theme-customize-panel { margin-top: 12px; }
.theme-customize-panel[hidden] { display: none; }
.theme-color-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 8px;
}
.theme-color-row label { font-size: 0.78rem; color: var(--color-text-secondary); }
.theme-color-row input[type="color"] {
    width: 32px; height: 26px; padding: 1px;
    border: 1px solid var(--color-border); border-radius: 4px;
    cursor: pointer; background: transparent;
}
.theme-reset-btn {
    width: 100%; margin-top: 8px; padding: 4px 8px;
    border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px);
    background: transparent; color: var(--color-text-muted);
    font-size: 0.75rem; cursor: pointer;
    transition: color 0.15s;
}
.theme-reset-btn:hover { color: var(--color-loss); }

@media (max-width: 768px) {
    .theme-picker { bottom: calc(12px + env(safe-area-inset-bottom));
                    right: calc(12px + env(safe-area-inset-right)); }
    .theme-picker-toggle { width: 44px; height: 44px; font-size: 1rem; }
    .theme-picker-panel { min-width: 190px; padding: 12px; }
    .theme-swatch { width: 30px; height: 30px; }
}
```

### 5.3 `themePicker.js` — the menu's behavior

ES module. Call `initThemePicker({ appKey, trigger })` once at startup. Pass your app's name as `appKey` (it becomes the localStorage prefix). Pass `trigger` if you want to attach to your own button instead of the default floating circle.

```js
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

    const getTheme  = () => localStorage.getItem(STORAGE_KEY) || 'current';
    const setTheme  = (t) => {
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
            Object.entries(v).forEach(([k, val]) => document.documentElement.style.setProperty(k, val));
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
                CUSTOMIZABLE_VARS.forEach(v => doc.documentElement.style.removeProperty(v.key));
                if (customRaw) {
                    const cv = JSON.parse(customRaw);
                    Object.entries(cv).forEach(([k, val]) =>
                        doc.documentElement.style.setProperty(k, val));
                }
            } catch {}
        }
    };
    const computedVar = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    const toHex = (rgb) => {
        if (rgb.startsWith('#')) return rgb.length === 4 || rgb.length === 7 ? rgb : rgb.slice(0, 7);
        const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
        return m ? '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('') : '#000000';
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

    panel.appendChild(Object.assign(document.createElement('div'), { className: 'theme-picker-divider' }));

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

    // Default trigger if host did not pass one
    let triggerEl = trigger;
    if (!triggerEl) {
        triggerEl = document.createElement('button');
        triggerEl.className = 'theme-picker-toggle';
        triggerEl.setAttribute('aria-label', 'Change theme');
        triggerEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
        root.appendChild(triggerEl);
    }
    triggerEl.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) refreshInputs();
    });

    document.addEventListener('click', (e) => {
        if (!root.contains(e.target) && e.target !== triggerEl) panel.hidden = true;
    });

    root.appendChild(panel);
    document.body.appendChild(root);
}
```

### 5.4 The FOUC bootstrap (must run **before** CSS paints)

Drop this `<script>` in `<head>`, immediately after the `<link rel="stylesheet">` lines. It applies the saved theme & overrides synchronously, so the first paint is correct.

```html
<script>
  (function(){
    var APP_KEY = 'app'; /* same prefix you pass to initThemePicker */
    var t = localStorage.getItem(APP_KEY + '-theme');
    if (t && t !== 'current') document.documentElement.dataset.theme = t;
    var c = localStorage.getItem(APP_KEY + '-custom-vars');
    if (c) { try { var v = JSON.parse(c);
      for (var k in v) document.documentElement.style.setProperty(k, v[k]);
    } catch (e) {} }
  })();
</script>
```

### 5.5 Wiring (host page)

```html
<head>
  <link rel="stylesheet" href="variables.css">     <!-- your default :root tokens -->
  <link rel="stylesheet" href="themes.css">        <!-- §5.1 -->
  <link rel="stylesheet" href="theme-picker.css">  <!-- §5.2 -->
  <script>/* FOUC bootstrap from §5.4 */</script>
</head>
<body>
  ...your app...
  <script type="module">
    import { initThemePicker } from './themePicker.js';
    initThemePicker({ appKey: 'myapp' });
    // Or attach to your own button:
    // initThemePicker({ appKey: 'myapp', trigger: document.querySelector('#settings-theme-btn') });
  </script>
</body>
```

That's it. Theme switching, customization, persistence, and iframe sync work end-to-end with no other dependencies.

---

## 6. Migrating to a new app — checklist

1. Copy `themes.css`, `theme-picker.css`, `themePicker.js`, FOUC snippet.
2. Author your own `variables.css` defining the **default** theme's tokens (the `:root` block from §2.2 → `current`). Tweak colors to match your brand if you want — themes.css is unchanged.
3. Make sure every UI surface in your app uses `var(--color-*)`, not hardcoded hex/rgb. If a hex value sneaks in, the theme switch will leave a stain.
4. Pick which roles are honored (§3.4). Don't worry about the rest.
5. Pass your app key (e.g., `'myapp'`) to both the FOUC script and `initThemePicker`. Theme + overrides will live in `myapp-theme` / `myapp-custom-vars` — no collision with other apps on the same domain.
6. Decide where the trigger lives. Default is a floating circle bottom-right; pass `trigger:` to attach to anything else.
7. Ship.
