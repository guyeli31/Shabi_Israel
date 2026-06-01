"""
Fetch a country flag PNG from msikma/country-flags and normalize it to the
project's icon style: 1600x1600 RGBA, stretched to fill, with the exact
rounded-corner alpha mask copied byte-for-byte from assets/flags/BE.png.

Usage:
    python scripts/apply-flag-mask.py <CODE> <OUT_DIR> [--fill RRGGBB]

Examples:
    python scripts/apply-flag-mask.py GE assets/flags
    python scripts/apply-flag-mask.py FR assets/flags --fill FFFFFF

<CODE> is a 2-letter ISO country code (case-insensitive). The output is
written to <OUT_DIR>/<CODE-uppercase>.png. If the upstream PNG has any
transparency, it is composited onto --fill (default white) before the
final mask is applied.
"""
import argparse
import io
import sys
import urllib.request
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
MASK_SOURCE = REPO_ROOT / "assets" / "flags" / "BE.png"
UPSTREAM = "https://raw.githubusercontent.com/msikma/country-flags/master/flags/png/{code}.png"
SIZE = (1600, 1600)


def parse_hex_color(s: str) -> tuple[int, int, int, int]:
    s = s.lstrip("#")
    if len(s) != 6:
        raise ValueError(f"Expected RRGGBB, got {s!r}")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


def fetch_flag(code: str) -> Image.Image:
    url = UPSTREAM.format(code=code.lower())
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise SystemExit(f"error: no upstream flag for code {code!r} ({url})")
        raise
    return Image.open(io.BytesIO(data)).convert("RGBA")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("code", help="2-letter country code, e.g. GE")
    ap.add_argument("out_dir", type=Path, help="Target directory")
    ap.add_argument("--fill", default="FFFFFF",
                    help="Background fill hex for transparent inputs (default FFFFFF)")
    args = ap.parse_args()

    code = args.code.upper()
    fill = parse_hex_color(args.fill)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"{code}.png"

    mask = Image.open(MASK_SOURCE).convert("RGBA").split()[3]

    src = fetch_flag(code)
    bbox = src.getbbox()
    if bbox is None:
        print(f"error: upstream flag for {code} is fully transparent", file=sys.stderr)
        return 1
    cropped = src.crop(bbox)
    bg = Image.new("RGBA", cropped.size, fill)
    flat = Image.alpha_composite(bg, cropped)

    out = flat.resize(SIZE, Image.LANCZOS)
    out.putalpha(mask)
    out.save(out_path, optimize=True)
    print(f"wrote {out_path} ({SIZE[0]}x{SIZE[1]} RGBA)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
