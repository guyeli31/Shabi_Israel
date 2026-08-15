# League logo — canonical source & assets

## Files

| File | Role |
|------|------|
| **`logo.svg`** | **Canonical, editable master.** Edit this to change the ring text. Self-contained: fonts (Roboto Condensed 700 Latin, Heebo 800 Hebrew) and the center board art are embedded as base64, so it renders identically everywhere — online, offline, or via `<img>`. |
| `logo.png` | Production raster (640×640), **generated from `logo.svg`**. This is what every page/consumer actually loads (`assets/logo/logo.png`). Regenerate it after editing the SVG (see below). |
| `favicon-round.png` (in `assets/`) | A distinct round-crop tab icon — **not** derived from this file. |
| `board-clean.jpg`, `Main photo.jpeg` | Hero/banner background photos, unrelated to the logo mark. |

## How the SVG is built (path 1 — embedded-center + vector ring)

The intricate center **board art (checkers, dice, points) is kept as an embedded raster** cropped from the original PNG (disc, radius 214). Everything around it is redrawn as **vector**: a navy disc (`#09336d`, r=302 on a white background) plus two curved text runs on circular `<textPath>`s. This is why the text is editable while the board looks pixel-identical to the original.

Geometry (viewBox `0 0 640 640`, center 320,320):
- **Bottom text** (English): `textPath` on an arc at radius 256, spanning 165°→15° through the bottom, Roboto Condensed 700, font-size 50, letter-spacing −0.3, `dominant-baseline=central`.
- **Top text** (Hebrew): arc at radius 255, 227°→319° through the top, Heebo 800, font-size 52, `direction=rtl`.

> **Why Roboto Condensed?** The font was chosen by *measuring the original*: the ring text was unwrapped from the arc into a flat strip (polar→cartesian sampling) to read its letterforms directly. It is a **condensed neo-grotesque** (Arial/Helvetica DNA — note the spurred `G`, straight-leg `R`, mid-vertex `M`), tall (cap-height ~37–40px) and filling the band close to the outer edge, with an average glyph advance of ~0.47em. That combination rules out three tempting-but-wrong choices: a *geometric* font (Montserrat) is too wide, so it can't be set tall enough to fill the band without overflowing the arc; a plain grotesque (Arial/Roboto) is still a touch too wide; and a *humanist condensed* (Barlow Condensed) has the right width but the wrong letterforms. Roboto Condensed is condensed **and** neo-grotesque — the actual match. Keep any replacement in that same lane (condensed grotesque).

## Editing the ring text — the visual tool (recommended)

Launch it with **`tools/START_LOGO_EDITOR.bat`** (double-click — reuses/starts the local server and opens the page, exactly like `START_BANNER_EDITOR.bat`), or open **`logo-editor.html`** (repo root) directly over http:// in Chrome/Edge — a banner-editor-style tool that edits **only the ring texts and their font sizes** (the logo size is fixed). It shows a live logo preview *and* a live hero-banner preview (so you see the banner update from the same logo). **Save to site** rasterizes the result to `assets/logo/logo.png` (640×640) and rewrites the master `assets/logo/logo.svg`; the first save asks once for read-write access to the `assets/logo` folder. The last-saved values become the defaults next time (read back from `logo.svg`, with a same-browser `localStorage` draft for instant continuity). Any page that loads the logo — including the banner — shows the new image on reload, because they all reference the same `logo.png` path.

## Editing the ring text — by hand

Open `logo.svg` and change the string inside the relevant `<textPath>`:

```xml
<!-- bottom edge (English) -->
<textPath href="#bottomArc" startOffset="50%">ISRAELI BACKGAMMON LEAGUE</textPath>
<!-- top edge (Hebrew) -->
<textPath href="#topArc" startOffset="50%">ליגת השש בש</textPath>
```

The embedded fonts cover the full Latin and Hebrew ranges, so any English/Hebrew text renders. If the new string is longer, it may not fit the arc — shrink `font-size` (or widen the arc angles) on that `<text>` element until it fits; if much shorter, nudge `font-size`/`letter-spacing` up so it fills the band.

## Re-exporting `logo.png` after an edit

`logo.png` must be regenerated from `logo.svg` so the site picks up the change (all consumers load the PNG, not the SVG). Any of these works — pick what you have:

- **Inkscape:** `inkscape logo.svg --export-type=png -w 640 -h 640 -o logo.png`
- **rsvg-convert** (librsvg): `rsvg-convert -w 640 -h 640 logo.svg -o logo.png`
- **Browser/Playwright:** load the SVG, draw it to a 640×640 canvas, `toDataURL('image/png')`, save. (This is how the SVG itself was assembled and verified.)

> Note: `resvg`/`rsvg`/Inkscape all read the embedded woff2 fonts, so no font install is needed. Keep the export at **640×640** to stay a drop-in replacement for the current PNG.
