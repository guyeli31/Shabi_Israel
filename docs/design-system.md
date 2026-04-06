# Design System

## CSS Architecture

Styling is split across 4 files, each with a distinct scope:

| File | Scope |
|------|-------|
| `variables.css` | Design tokens — CSS custom properties only |
| `layout.css` | Page structure — containers, header, responsive |
| `components.css` | UI components — tables, badges, medals, pills |
| `theme.css` | Data-driven utility classes (minimal) |

All 4 files are loaded by every HTML page. No file depends on import order except that `variables.css` must load first (defines the custom properties used by the others).

---

## Design Tokens (`variables.css`)

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#f0f2f5` | Page background |
| `--color-surface` | `#ffffff` | Card/table backgrounds |
| `--color-text` | `#1a1a2e` | Primary text |
| `--color-text-secondary` | `#555770` | Subtitles, secondary info |
| `--color-text-muted` | `#8888a0` | Disabled/muted text |
| `--color-accent` | `#2563eb` | Links, interactive elements |
| `--color-accent-light` | `#dbeafe` | Hover backgrounds |

### Medal Colors

| Medal | Color | Background |
|-------|-------|-----------|
| Gold | `#fbbf24` | `#fef3c7` |
| Silver | `#9ca3af` | `#f3f4f6` |
| Bronze | `#d97706` | `#fef3c7` |

### Status Colors

| Status | Color |
|--------|-------|
| Running | `#059669` (green) |
| Completed | `#6b7280` (gray) |

### Result Colors

| Result | Color |
|--------|-------|
| Win | `#059669` |
| Loss | `#dc2626` |
| Draw | `#6b7280` |

### Typography

System font stack — no external fonts loaded:

```css
--font-main: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
--font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
```

### Spacing Scale

| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 40px |
| `--space-2xl` | 64px |

### Borders & Shadows

| Token | Value |
|-------|-------|
| `--radius-sm` | 6px |
| `--radius-md` | 10px |
| `--radius-lg` | 16px |
| `--radius-full` | 9999px |
| `--shadow-sm` | 0 1px 2px rgba(0,0,0,0.05) |
| `--shadow-md` | 0 4px 6px rgba(0,0,0,0.08) |
| `--shadow-lg` | 0 8px 16px rgba(0,0,0,0.12) |

---

## Color Gradient System

Numeric values in tables are color-coded using a **red → yellow → green** gradient, computed in `colorScale.js`.

### Interpolation

The gradient uses piecewise linear interpolation:

```
ratio = 0.0  →  rgb(220,   0, 0)    Red
ratio = 0.5  →  rgb(220, 140, 0)    Yellow
ratio = 1.0  →  rgb(  0, 200, 0)    Green
```

- **First half** (0→0.5): Interpolates R and G between red and yellow
- **Second half** (0.5→1): Interpolates R and G between yellow and green

### Normal vs Inverted

| Mode | Higher Value = | Used For |
|------|---------------|----------|
| Normal | Greener (better) | Wins, Win Rate, Luck, Games |
| Inverted | Redder (worse) | Losses, Mean PR |

### Relative Scaling

Min and max are calculated from the **current dataset** for each column. This means colors adapt to each league — a "green" value in one league might be "yellow" in another.

Exception: Games column uses a **fixed scale** of 0–25.

---

## Responsive Design

### Breakpoint

Single breakpoint at **768px** (tablet/mobile):

| Property | Desktop | Mobile (≤768px) |
|----------|---------|-----------------|
| Base font | 15px | 13px |
| Page padding | `--space-md` (16px) | `--space-sm` (8px) |
| h1 size | 2rem | 1.5rem |

### Scrollable Tables

Tables are wrapped in `.table-scroll` with `overflow-x: auto`, allowing horizontal scrolling on small screens. Cell content uses `white-space: nowrap` to prevent wrapping.

### Sticky Elements

- **Table headers** — `position: sticky; top: 0` (z-index 3)
- **Averages row** — `position: sticky; bottom: 0` (z-index 2)

Both remain visible during vertical scroll.

---

## Key Components

### Medal Badges

22px circles with centered rank number. Fully rounded (`border-radius: 9999px`), bold 0.75rem font.

### Status Pills

Inline-block badges with full rounding. Small font (0.75rem), 600 weight. Green for Running, gray for Completed.

### Flag Images

- **In-table:** 16px height, 2px border-radius, 6px right margin
- **In title:** 24px height, 3px border-radius, 8px right margin

Both use `vertical-align: middle` for alignment with text.

### Player Cell

Left-aligned (unlike other centered cells), bold text. Links are dark-colored and turn blue on hover.