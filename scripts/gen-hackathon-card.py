#!/usr/bin/env python3
"""Generate the Encode Club hackathon project card (1200x630 PNG) — SnapFlip's
cassette-futurist tokens, same as gen-og.py. Shows the demo beat: badged agents
bid, the unbadged one is refused.

Usage: uv run --with pillow python scripts/gen-hackathon-card.py
→ docs/media/hackathon-card.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (23, 14, 5)
PHOS = (255, 179, 56)
DIM = (138, 92, 16)
INK = (240, 230, 207)
MUTED = (171, 135, 80)
RED = (255, 92, 92)
CHIP = (46, 30, 10)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "media", "hackathon-card.png")

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
    for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
        draw.text((x + dx, y + dy), text, font=fnt, fill=glow)
    draw.text((x, y), text, font=fnt, fill=color)


def mark(draw, x, y, ok):
    """Draw a check or cross in a 24px box (fonts lack the glyphs)."""
    color = PHOS if ok else RED
    if ok:
        draw.line([(x, y + 12), (x + 8, y + 20), (x + 24, y + 2)], fill=color, width=5)
    else:
        draw.line([(x + 2, y + 2), (x + 22, y + 22)], fill=color, width=5)
        draw.line([(x + 22, y + 2), (x + 2, y + 22)], fill=color, width=5)


def chip(draw, x, y, w, h, label, ok):
    border = PHOS if ok else RED
    fill = CHIP if ok else BG
    draw.rounded_rectangle([x, y, x + w, y + h], radius=10, outline=border, width=3, fill=fill)
    mark(draw, x + 22, y + h // 2 - 12, ok)
    draw.text((x + 62, y + h // 2 - 22), label, font=font(40), fill=INK if ok else RED)


def text_w(draw, text, fnt) -> int:
    return int(draw.textlength(text, font=fnt))


def main() -> None:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    for y in range(0, H, 4):
        d.line([(0, y), (W, y)], fill=(0, 0, 0))
    d.rectangle([8, 8, W - 9, H - 9], outline=DIM, width=3)

    f_head = font(96)
    glow_text(d, (70, 56), "snapflip", font(64), PHOS, DIM)
    d.text((70, 165), "VERIFIED", font=f_head, fill=INK)
    d.text((70, 295), "AGENTS ONLY.", font=f_head, fill=INK)

    # the demo beat: two badged agents in, the unbadged one refused
    chip(d, 70, 460, 262, 82, "Agent #1", True)
    chip(d, 358, 460, 262, 82, "Agent #2", True)
    chip(d, 646, 460, 394, 82, "Agent #3  refused", False)

    for i, line in enumerate(("60s auctions", "x402 + PLT", "audit trail")):
        d.text((880, 170 + i * 60), line, font=font(44), fill=PHOS)

    d.text((70, 580), "go.snapflip.workers.dev", font=font(32), fill=MUTED)
    tag = "concordium trusted agents hackathon"
    f_foot = font(28)
    d.text((W - 40 - text_w(d, tag, f_foot), 582), tag, font=f_foot, fill=MUTED)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
