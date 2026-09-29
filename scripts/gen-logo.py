#!/usr/bin/env python3
"""Generate the SnapFlip square logo (512x512 PNG) for the Agent Index listing
and anywhere a brand mark is needed. Same cassette-futurist tokens as gen-og.py.

Usage: python3 scripts/gen-logo.py  →  docs/media/logo.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

W = 512
BG = (23, 14, 5)
PHOS = (255, 179, 56)
DIM = (138, 92, 16)
INK = (240, 230, 207)
TAG_BG = (240, 226, 168)
TAG_INK = (28, 26, 20)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "media", "logo.png")

CANDIDATE_FONTS = [
    "/System/Library/Fonts/Andale Mono.ttf",
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]


def font(size: int):
    for path in CANDIDATE_FONTS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def glow_text(draw: ImageDraw.ImageDraw, xy, text, fnt, color, glow):
    x, y = xy
    for dx, dy in ((3, 0), (-3, 0), (0, 3), (0, -3)):
        draw.text((x + dx, y + dy), text, font=fnt, fill=glow)
    draw.text((x, y), text, font=fnt, fill=color)


def main() -> None:
    img = Image.new("RGB", (W, W), BG)
    d = ImageDraw.Draw(img)

    # scanlines + vignette frame
    for y in range(0, W, 4):
        d.line([(0, y), (W, y)], fill=(0, 0, 0))
    d.rectangle([6, 6, W - 7, W - 7], outline=DIM, width=3)

    # "S>" desk monogram, phosphor glow, centered
    f_mono = font(230)
    tw = d.textlength("S>", font=f_mono)
    glow_text(d, ((W - tw) / 2, 96), "S>", f_mono, PHOS, DIM)

    # price-tag motif
    d.rounded_rectangle([W / 2 - 130, 360, W / 2 + 130, 430], radius=10, fill=TAG_BG)
    d.ellipse([W / 2 - 110, 385, W / 2 - 95, 400], fill=BG)
    f_tag = font(44)
    tw = d.textlength("snapflip", font=f_tag)
    d.text((W / 2 - tw / 2 + 16, 372), "snapflip", font=f_tag, fill=TAG_INK)

    img.save(OUT)
    print(f"{OUT} written")


if __name__ == "__main__":
    main()
