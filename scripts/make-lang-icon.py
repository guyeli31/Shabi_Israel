"""
Crop an existing assets/flags/<CODE>.png (already 1600x1600, rounded-rect
masked) down to a full circle, for use as a small language-switcher icon —
visually distinct from the rounded-rectangle flags used elsewhere in the app
(player flags, league flags), so a language toggle is never mistaken for a
player's nationality flag.

Usage:
    python scripts/make-lang-icon.py <CODE> [OUT_DIR]

Example:
    python scripts/make-lang-icon.py GB assets/lang-icons
    python scripts/make-lang-icon.py IL assets/lang-icons
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "assets" / "flags"
SIZE = (256, 256)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python scripts/make-lang-icon.py <CODE> [OUT_DIR]", file=sys.stderr)
        return 1
    code = sys.argv[1].upper()
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else REPO_ROOT / "assets" / "lang-icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    src_path = SRC_DIR / f"{code}.png"
    raw = Image.open(src_path).convert("RGBA")
    # The source is letterboxed inside its rounded-rect canvas (most flags
    # aren't 1:1), so crop to the actual flag content first and stretch
    # that to fill the full circle — otherwise the circle mask alone would
    # leave flat transparent bands where the letterboxing was.
    bbox = raw.getbbox()
    content = raw.crop(bbox) if bbox else raw
    src = content.resize(SIZE, Image.LANCZOS)

    circle_mask = Image.new("L", SIZE, 0)
    draw = ImageDraw.Draw(circle_mask)
    draw.ellipse((0, 0, SIZE[0] - 1, SIZE[1] - 1), fill=255)

    out = src.copy()
    out.putalpha(circle_mask)
    out_path = out_dir / f"{code}.png"
    out.save(out_path, optimize=True)
    print(f"wrote {out_path} ({SIZE[0]}x{SIZE[1]} RGBA, circular)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
