"""Regenerate every raster brand asset from public/icon.svg, in one run.

    py -3 scripts/branding.py

Produces, into public/: the 9-file icon set (favicons, apple-touch, PWA icons,
favicon.ico) plus the three 1200x630 share cards (og-image.png,
og-know-the-facts.png, og-anecdote-library.png). icon.svg is the single source
of truth for the mark; edit it, run this, commit what changed.

Dependencies (pure Python, no native tools):
    py -3 -m pip install pillow svglib reportlab rlPyCairo
rlPyCairo is renderPM's backend; without it renderPM fails with
"cannot import desired renderPM backend rlPyCairo".

Fonts: the cards set real Georgia and Segoe UI from C:\\Windows\\Fonts (the
site's --display face and a neutral sans). On a non-Windows box, point GEORGIA*
and SEGOE at equivalent TTFs.

Hard-won details encoded below, do not "simplify" them away:
  - renderPM ignores bg=None and mattes the canvas to opaque black, turning the
    SVG's rounded corners into black triangles. The alpha is re-cut with
    Pillow's rounded_rectangle at the SVG's own radius (rx=14 on a 100 box)
    BEFORE any downscale, so every size inherits clean corners.
  - One 512 master is rendered and every other size is a LANCZOS DOWNSCALE of
    it. Never upscale, and never render sizes independently: they drift.
  - Every text line on the cards is guarded by a textlength assert; the first
    og-image render clipped on the right edge, and a clipped card on someone's
    timeline is worse than none.
  - Copy rule: no organic claims (removed sitewide 2026-08-08) and no em
    dashes anywhere in card text.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPM

REPO = Path(__file__).resolve().parents[1]
PUB = REPO / "public"
MASTER = 512

GEORGIA_B = r"C:\Windows\Fonts\georgiab.ttf"
GEORGIA_I = r"C:\Windows\Fonts\georgiai.ttf"
SEGOE = r"C:\Windows\Fonts\segoeui.ttf"

BG = (11, 18, 13)        # --bg
INK = (234, 243, 236)    # --ink
GOLD = (201, 150, 47)
MUTED = (159, 182, 166)  # --muted
KEYLINE = (38, 112, 32)  # the bells' stroke green


def render_master() -> Image.Image:
    drawing = svg2rlg(str(PUB / "icon.svg"))
    if drawing is None:
        sys.exit("FAIL: svglib could not parse public/icon.svg")
    scale = MASTER / float(drawing.width)
    drawing.width, drawing.height = MASTER, MASTER
    drawing.scale(scale, scale)
    tmp = PUB / ".master.tmp.png"
    renderPM.drawToFile(drawing, str(tmp), fmt="PNG", bg=None)
    im = Image.open(tmp).convert("RGBA")
    tmp.unlink()
    if im.size != (MASTER, MASTER):
        sys.exit(f"FAIL: master is {im.size}")
    mask = Image.new("L", (MASTER, MASTER), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, MASTER - 1, MASTER - 1], radius=round(14 * MASTER / 100), fill=255)
    im.putalpha(mask)
    return im


def write_icons(master: Image.Image) -> None:
    targets = [
        ("icon-512.png", 512), ("icon-192.png", 192),
        ("apple-touch-icon.png", 180), ("apple-icon.png", 180),
        ("favicon-32x32.png", 32), ("icon-light-32x32.png", 32),
        ("icon-dark-32x32.png", 32), ("favicon-16x16.png", 16),
    ]
    for name, size in targets:
        out = master if size == MASTER else master.resize((size, size), Image.LANCZOS)
        out.save(PUB / name, "PNG", optimize=True)
        print("icon ", name)
    master.resize((64, 64), Image.LANCZOS).save(
        PUB / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("icon  favicon.ico")


def card_base() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)
    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    cx, cy, r = 150, 40, 520
    for i in range(r, 0, -4):
        gd.ellipse([cx - i, cy - i, cx + i, cy + i], fill=int(18 * (1 - i / r)))
    img = Image.composite(Image.new("RGB", (W, H), (30, 48, 36)), img, glow)
    return img, ImageDraw.Draw(img)


def spaced(d, x, y, text, font, fill, track):
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + track
    return x


def write_home_card(master: Image.Image) -> None:
    W = 1200
    img, d = card_base()
    georgia_b = ImageFont.truetype(GEORGIA_B, 84)
    georgia_i = ImageFont.truetype(GEORGIA_I, 34)
    segoe = ImageFont.truetype(SEGOE, 27)
    img.paste(master.resize((400, 400), Image.LANCZOS), (80, 115),
              master.resize((400, 400), Image.LANCZOS))
    tx = 540
    d.text((tx, 160), "Herbal Leaf", font=georgia_b, fill=INK)
    d.text((tx, 258), "Market", font=georgia_b, fill=INK)
    x = spaced(d, tx, 392, "BOTANICAL APOTHECARY", georgia_i, GOLD, 5)
    body = ["CBD, CBG, herbal blends & teas from",
            "independent makers. Non-intoxicating. 21+"]
    d.text((tx, 466), body[0], font=segoe, fill=MUTED)
    d.text((tx, 504), body[1], font=segoe, fill=MUTED)
    d.rectangle([0, 0, W, 6], fill=KEYLINE)
    d.rectangle([0, 624, W, 630], fill=KEYLINE)
    for txt, f in [("Herbal Leaf", georgia_b), ("Market", georgia_b),
                   (body[0], segoe), (body[1], segoe)]:
        assert tx + d.textlength(txt, font=f) < W - 40, f"overflow: {txt!r}"
    assert x < W - 40, "overflow: subtitle"
    img.save(PUB / "og-image.png", "PNG", optimize=True)
    print("card  og-image.png")


PAGE_CARDS = [
    {"out": "og-know-the-facts.png", "title": ["Know", "the Facts"],
     "sub": "THE 2018 FARM BILL & THE 2026 HEMP BAN",
     "body": ["A plain-language explainer of the hemp ban",
              "and what it means for legal CBD & CBG access."],
     "title_size": 84},
    {"out": "og-anecdote-library.png", "title": ["The Anecdote", "Library"],
     "sub": "REAL STORIES ON LEGAL CANNABINOIDS",
     "body": ["Sourced, citable testimonials, gathered to",
              "inform the 2026 hemp-law debate."],
     "title_size": 80},
]


def write_page_cards(master: Image.Image) -> None:
    W = 1200
    for card in PAGE_CARDS:
        img, d = card_base()
        georgia_b = ImageFont.truetype(GEORGIA_B, card["title_size"])
        georgia_i = ImageFont.truetype(GEORGIA_I, 30)
        segoe = ImageFont.truetype(SEGOE, 27)
        m = master.resize((400, 400), Image.LANCZOS)
        img.paste(m, (80, 115), m)
        tx = 540
        x = spaced(d, tx, 128, "HERBAL LEAF MARKET", georgia_i, GOLD, 4)
        assert x < W - 40, "overflow: site strap"
        y = 185
        for line in card["title"]:
            d.text((tx, y), line, font=georgia_b, fill=INK)
            assert tx + d.textlength(line, font=georgia_b) < W - 40, f"overflow: {line!r}"
            y += int(card["title_size"] * 1.14)
        y += 24
        for size in (26, 24, 22, 20):   # shrink the gold sub-line to fit, never clip
            sub_f = ImageFont.truetype(GEORGIA_I, size)
            track = 3 if size > 22 else 2
            need = sum(d.textlength(ch, font=sub_f) + track for ch in card["sub"])
            if tx + need < W - 40:
                break
        x = spaced(d, tx, y, card["sub"], sub_f, GOLD, track)
        assert x < W - 40, "overflow: sub"
        y += 62
        for line in card["body"]:
            d.text((tx, y), line, font=segoe, fill=MUTED)
            assert tx + d.textlength(line, font=segoe) < W - 40, f"overflow: {line!r}"
            y += 38
        d.rectangle([0, 0, W, 6], fill=KEYLINE)
        d.rectangle([0, 624, W, 630], fill=KEYLINE)
        img.save(PUB / card["out"], "PNG", optimize=True)
        print("card ", card["out"])


if __name__ == "__main__":
    master = render_master()
    write_icons(master)
    write_home_card(master)
    write_page_cards(master)
    print("done; git status will show anything that actually changed")
