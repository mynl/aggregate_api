"""Draw the link preview card, ``web/public/social-card.png``.

The image Facebook, LinkedIn, X, Slack, Teams, iMessage and Outlook show when
a link to the site is pasted: the mark from ``aggregate-api-trim.png`` on the
left, the wordmark, kicker and address on the right. 1200 by 630 is the 1.91:1
shape Facebook and LinkedIn draw at full width; X crops to 2:1, which costs 15
pixels top and bottom, so nothing sits within 40 of either edge.

Run from the repository root, once, and commit the PNG it writes:

    uv run --no-sync python dev/scripts/make-social-card.py

The font is found through matplotlib's font manager rather than by path:
Segoe UI Bold where it is installed (the app's own face on Windows), else
DejaVu Sans Bold, which matplotlib ships.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from matplotlib import font_manager
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"

WIDTH, HEIGHT = 1200, 630
# Sampled from the mark, so the type matches it exactly.
NAVY = (3, 22, 41)
RED = (168, 19, 19)
MUTED = (108, 117, 125)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    """The app's face at `size` pixels, through matplotlib's font search."""
    props = font_manager.FontProperties(family=["Segoe UI", "DejaVu Sans"],
                                        weight="bold" if bold else "normal")
    return ImageFont.truetype(font_manager.findfont(props), size)


def spaced(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str,
           face: ImageFont.FreeTypeFont, fill, tracking: float) -> None:
    """Draw `text` one character at a time with `tracking` pixels between.

    Pillow has no letter spacing, and the kicker is set wide, as the navbar's
    ``.brand-kicker`` is.
    """
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=face, fill=fill)
        x += draw.textlength(char, font=face) + tracking


def spaced_width(draw: ImageDraw.ImageDraw, text: str,
                 face: ImageFont.FreeTypeFont, tracking: float) -> float:
    """The width :func:`spaced` covers, without the trailing space."""
    return sum(draw.textlength(c, font=face) for c in text) + tracking * (len(text) - 1)


def main() -> None:
    """Compose the card and write it."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--address", default="agg.mynl.com",
                        help="the address printed under the kicker")
    parser.add_argument("--out", type=Path, default=PUBLIC / "social-card.png")
    args = parser.parse_args()

    card = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(card)

    # The mark's ground is opaque near-white with compression speckle, which
    # shows as a faint box on a pure white card. Lift it to white.
    pixels = np.asarray(Image.open(PUBLIC / "aggregate-api-trim.png").convert("RGB")).copy()
    pixels[pixels.min(axis=2) >= 232] = 255
    mark = Image.fromarray(pixels)
    mark_h = 360
    mark_w = round(mark.width * mark_h / mark.height)
    mark = mark.resize((mark_w, mark_h), Image.LANCZOS)
    left = 96
    top = (HEIGHT - mark_h) // 2 - 6
    card.paste(mark, (left, top))

    # The text block: two lines of wordmark, the kicker, the address. Laid out
    # from its measured height so it centers on the mark.
    x = left + mark_w + 64
    title = font(112)
    kicker = font(25)
    address = font(30, bold=False)
    ascent, descent = title.getmetrics()
    line = ascent + descent - 18
    block = 2 * line + 22 + 30 + 34 + 34
    y = top + (mark_h - block) // 2 - 10
    draw.text((x, y), "aggregate", font=title, fill=NAVY)
    draw.text((x, y + line), "Loss Lab", font=title, fill=RED)

    words = "DESCRIPTION TO DISTRIBUTION"
    word_w = draw.textlength("aggregate", font=title)
    tracking = (word_w - spaced_width(draw, words, kicker, 0)) / (len(words) - 1)
    ky = y + 2 * line + 22
    spaced(draw, (x, ky), words, kicker, MUTED, max(tracking, 2.0))
    draw.text((x, ky + 34 + 34), args.address, font=address, fill=MUTED)

    # A rule along the foot in the mark's red. X's 2:1 crop takes it off,
    # and the card reads the same without it.
    draw.rectangle((0, HEIGHT - 12, WIDTH, HEIGHT), fill=RED)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    card.save(args.out, optimize=True)
    print(f"wrote {args.out} ({args.out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
