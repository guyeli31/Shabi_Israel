# Typography System

Single source of truth for all textual styling in the Shabi Israel project. Every text element on every page must follow this spec — no per-component `font-size` / `font-weight` declarations, no `!important`, no overrides scattered across CSS files. Defined once, applied via design tokens.

> **Companion document:** [TYPOGRAPHY-INVENTORY.md](./TYPOGRAPHY-INVENTORY.md) — per-page mapping of every textual element with its assigned token (size + weight). Authoritative reference for refactor & audit. Must be kept current as elements are added or moved.

---

## 1. Two axes, two systems

| Axis | Values | Purpose |
|---|---|---|
| **font-size** | 7 discrete tokens (Micro → Display) | Visual hierarchy: bigger = more important |
| **font-weight** | 3 discrete tokens (400 / 600 / 700) | Emphasis hierarchy: heavier = more important |

The two axes are **orthogonal**. Any element picks one size token + one weight token. Anything outside the two scales is a bug.

---

## 2. The size scale — 7 fluid tokens on one slope

### 2.1 Linear scaling rule (the slope law)

Every textual element on every page scales **linearly with viewport width** according to one shared rate-of-change profile, extracted from the original `font-small` table modifier. For any token with desired desktop max **M** (in `rem`):

```
font-size: clamp(0.765·M·rem,  0.600·M·rem + 0.835·M·vw,  M·rem);
```

Coefficients:
- **0.765 · M** — mobile minimum (preserves legibility at 320 px viewport).
- **0.600 · M · rem + 0.835 · M · vw** — preferred linear interpolation.
- **M · rem** — desktop maximum.

This is the **font-small slope** scaled to each token's max. Because all tokens share the same `0.765 / 0.600 / 0.835` ratios scaled by their own M, the family has a critical mathematical property:

> **Ratios between any two tokens are constant at every viewport width.**
> If `--fs-large` is 1.32× `--fs-small` at desktop, it is 1.32× at mobile, at tablet, and everywhere in between.

The whole UI breathes as one rigid unit. Two elements share font-size if and only if they share a token.

### 2.2 The 7 size tokens

| Token | Max (rem) | Max (px @ html=15) | Usage |
|---|---|---|---|
| `--fs-micro` | **0.65** | ~9.75 | Footnotes, badge counters, micro-labels |
| `--fs-small` | **0.85** | ~12.75 | **Body / table data / chrome (font-small)** |
| `--fs-large` | **0.93** | ~13.95 | Slightly larger tables (font-large), prose body |
| `--fs-xl` | **1.10** | ~16.50 | Section headers, prominent labels |
| `--fs-2xl` | **1.35** | ~20.25 | Card headlines, league/page hero subtitles |
| `--fs-3xl` | **1.60** | ~24.00 | Brand, page titles |
| `--fs-display` | **2.00** | ~30.00 | Hero display, KPI numbers |

Names `font-small` and `font-large` are preserved as aliases for backward compatibility (table modifier classes), but new code must use the `--fs-*` tokens directly.

### 2.3 Why 7 and not more

Three sizes are too few for a 6-level hierarchy (page title → section title → card title → label → body → footnote). Twelve sizes invite drift and ad-hoc choices. Seven hits the sweet spot used by GitHub Primer, Stripe, Tailwind's `xs–3xl` core set, and Material 3's "display / headline / body / label" expanded scale.

---

## 3. The weight scale — 3 tokens

| Token | Numeric weight | Usage |
|---|---|---|
| `--fw-regular` | **400** | All data values (table numbers, body text, default content) |
| `--fw-subheading` | **600** | Subheadings, column headers (`<th>`), prominent metadata, button labels, breadcrumb regular items |
| `--fw-heading` | **700** | Page titles, hero headlines, brand mark, breadcrumb current item, **and specifically-flagged DATA emphasis** (best PR, peak value, total/average row) |

No `font-weight: 500`. No `font-weight: 800`. No `font-weight: 900`. No `<strong>` / `<b>` for visual styling — see §4.3.

### 3.1 Why 3 weights, not more

Modern UIs (Premier League standings, Stripe Dashboard, Linear, Google Sports) achieve full hierarchy with 3 weights because:
- Hierarchy can ride on **color + size**, not only on weight.
- More weights blur the distinction (500 vs 600 is invisible to most users at small sizes).
- 3 weights is what most well-designed dashboards converge to.

If a layout *cannot* be distinguished with these 3, the answer is to use color, padding, or size — not to introduce a 4th weight.

### 3.2 DATA emphasis = `--fw-heading` (700)

When a specific data point needs to stand out — best PR in a row, total/average row, current selection — apply weight **700** via a dedicated class. Examples that exist in the codebase today:
- `.matchup-pr-best { font-weight: var(--fw-heading); }`
- `.matchup-luck-best { font-weight: var(--fw-heading); }`
- `tr.avg-row td { font-weight: var(--fw-heading); }`
- `tr.b6b-bold td { font-weight: var(--fw-heading); }`

These are correct uses. New emphasis classes follow the same pattern.

---

## 4. Implementation rules

### 4.1 Tokens defined once in `css/typography-tokens.css`

```css
:root {
  /* Size scale — 7 tokens, font-small slope */
  --fs-micro:   clamp(0.497rem, 0.390rem + 0.543vw, 0.65rem);
  --fs-small:   clamp(0.650rem, 0.510rem + 0.710vw, 0.85rem);
  --fs-large:   clamp(0.711rem, 0.558rem + 0.777vw, 0.93rem);
  --fs-xl:      clamp(0.842rem, 0.660rem + 0.919vw, 1.10rem);
  --fs-2xl:     clamp(1.033rem, 0.810rem + 1.127vw, 1.35rem);
  --fs-3xl:     clamp(1.224rem, 0.960rem + 1.336vw, 1.60rem);
  --fs-display: clamp(1.530rem, 1.200rem + 1.670vw, 2.00rem);

  /* Weight scale — 3 tokens */
  --fw-regular:    400;
  --fw-subheading: 600;
  --fw-heading:    700;
}
```

No other CSS file declares `font-size:` with a literal value, and no other CSS file declares `font-weight:` other than referencing these tokens. Period.

### 4.2 Every textual rule uses tokens

```css
/* Correct */
.dash-card-value { font-size: var(--fs-xl); font-weight: var(--fw-heading); }
.dash-card-label { font-size: var(--fs-small); font-weight: var(--fw-subheading); }

/* Wrong — literal values */
.dash-card-value { font-size: 1.1rem; font-weight: 700; }
.dash-card-label { font-size: clamp(0.55rem, ...); font-weight: 600; }
```

### 4.3 `<strong>` and `<b>` are reset to `inherit`

In `css/layout.css` (loaded on every page), once:

```css
strong, b {
  font-weight: inherit;
}
```

Reason: the UA default is `font-weight: bolder`, which is **relative** and produces unpredictable jumps (e.g., 600 → 900). Resetting to `inherit` makes `<strong>` purely semantic — it carries accessibility meaning for screen readers, but visual weight is controlled exclusively by CSS classes mapped to the 3 weight tokens.

### 4.4 Form-control inheritance

In `css/layout.css`, once:

```css
button, input, select, textarea {
  font: inherit;
}
```

Reason: UA defaults give `<button>` a `font-family: Arial` and `font-size` based on `-webkit-small-control`, breaking the unified scale. `font: inherit` is the shorthand fix.

### 4.5 No `!important`. No overrides.

The current `css/typography-overrides.css` exists as a transitional layer while the project still has scattered per-component `font-size` / `font-weight` declarations. **The end state is for this file to be empty.** Every per-component declaration is removed and replaced with a token reference. Once that migration is complete, the overrides file is deleted and tokens carry 100% of typography.

### 4.6 Forbidden patterns going forward

- ❌ `font-size: 0.93rem;` — use `var(--fs-large)`.
- ❌ `font-size: clamp(0.7rem, 0.55rem + 0.5vw, 0.9rem);` — pick a token.
- ❌ `font-weight: 500;` — not in the scale. Use 400 or 600.
- ❌ `font-weight: bold;` — use `var(--fw-heading)`.
- ❌ `font-weight: bolder;` — relative, unpredictable. Banned.
- ❌ `<strong>Important data</strong>` for *visual* effect — wrap in a class instead.
- ❌ `!important` on any typography rule — if the cascade conflicts, fix the cascade.

---

## 5. typo-editor.html requirements

The typography editor at `typo-editor.html` must let the user, for any element on any page, pick:
- **font-size** from a dropdown with exactly 7 options: `--fs-micro`, `--fs-small`, `--fs-large`, `--fs-xl`, `--fs-2xl`, `--fs-3xl`, `--fs-display`.
- **font-weight** from a dropdown with exactly 4 options (allowing flexibility during exploration even though production uses 3): `--fw-regular` (400), `500` (experimental — not yet a token), `--fw-subheading` (600), `--fw-heading` (700).

Changes saved by the editor write to `css/typography-overrides.css` *temporarily* during a session. The maintainer reviews and commits accepted changes by editing the source CSS rule (replacing the literal token in the relevant `.css` file), then clearing the overrides file. The editor must never write `!important` or literal `clamp()` / `rem` values — only `var(--fs-*)` / `var(--fw-*)` token references.

---

## 6. Migration plan

Project-wide one-time pass:

1. **Add the 7 size tokens + 3 weight tokens** to `css/typography-tokens.css` (replacing the existing legacy `--fs-055` … `--fs-200` numeric set).
2. **Replace every `font-size:` declaration** across the 13 production CSS files with the appropriate `var(--fs-*)` token. Round to the nearest token; if a value falls between two tokens, pick the closer one and accept the small visual delta as a benefit of consolidation.
3. **Replace every `font-weight:` declaration** with `var(--fw-regular)`, `var(--fw-subheading)`, or `var(--fw-heading)`. If a rule currently uses 500 or 800, decide whether it's metadata (→ 600) or data (→ 400) or peak emphasis (→ 700).
4. **Add `strong, b { font-weight: inherit; }`** and **`button, input, select, textarea { font: inherit; }`** to `css/layout.css`.
5. **Empty `css/typography-overrides.css`** — the overrides file becomes a no-op.
6. **Audit per-page** using `docs/TYPOGRAPHY-INVENTORY.md` (see §7). Every element listed must point to one of the 7 sizes + one of the 3 weights.
7. **Verify ratio invariance** at 3 viewport widths (360 / 720 / 1440 px) — any two elements that share a size token must measure identical px values at every width.

---

## 7. Per-page inventory — see `TYPOGRAPHY-INVENTORY.md`

The companion file [TYPOGRAPHY-INVENTORY.md](./TYPOGRAPHY-INVENTORY.md) lists, for **every page including admin mode**, every textual element with its assigned size token and weight token. It is the authoritative cross-reference for:
- Refactor (which CSS rule maps to which token).
- Audit (does the live page match the spec?).
- Future additions (when adding a new element, you decide its size + weight, then record it in the inventory).

The inventory may start as a stub — but no element ships to production without an entry in it. Pull requests that add textual elements must update the inventory in the same commit.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Slope** | Rate of change of font-size with respect to viewport width. Measured in px per 100 viewport pixels. |
| **Token** | A named CSS custom property (`var(--fs-*)` or `var(--fw-*)`) representing one slot in the design system. |
| **Ratio invariance** | The property that `font-size(A) / font-size(B)` is constant across all viewport widths — guaranteed when both A and B use tokens from the same fluid family. |
| **`font-small` slope** | The specific rate-of-change profile `0.765·M / 0.600·M·rem + 0.835·M·vw / M·rem`. Origin: the matchup table's `clamp(0.65rem, 0.51rem + 0.71vw, 0.85rem)` rule. |
