"""Builds art/brand/tee-time-links.svg: the Tee Time Links logo, in two views of one file.

    #full  the wordmark: "Tee Time / Links" beside a sunset disc with a pine stand and a flag
    #mark  the compact square mark, for the flag cloth and the tee signs

The style is Clubhouse Sunset (drive/apps/web/src/ui/theme.css): its six colours, Shrikhand
lettering, and the sticker treatment of a thick ink outline over a hard ink drop shadow. The sun,
its stripes, the hills, the pines and the flag are TITLE_SCENE's shapes (drive/apps/web/src/ui/
art.ts), rescaled.

The lettering is Shrikhand (SIL OFL 1.1, @fontsource/shrikhand) converted to outlines, so the SVG
carries no <text> and needs no font. Edit this script, not the paths, and re-run it:

    pip install fonttools
    python art/brand/tee_time_links.py node_modules/@fontsource/shrikhand/files/shrikhand-latin-400-normal.woff art/brand/tee-time-links.svg

Shrikhand has no kerning between these letters, so glyphs are laid out on their advance widths.
"""

import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

INK, PINE, CREAM, SUN, SUNSET, CLAY = "#142018", "#1e4d2b", "#fff4dc", "#f6c343", "#f28c28", "#c84b31"
# TITLE_SCENE's hills, back to front.
HILL_MID, HILL_NEAR = "#2e7a43", "#3da35d"

OUTLINE = 14  # letter outline width; half of it shows outside the fill
SHADOW = (7, 9)  # hard drop shadow offset


def num(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


class Font:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.glyphs = self.tt.getGlyphSet()
        self.cmap = self.tt.getBestCmap()
        self.hmtx = self.tt["hmtx"]
        self.upm = self.tt["head"].unitsPerEm

    def path(self, text, size, x, baseline, anchor="start"):
        """`text` as one outlined path. Returns (d, (xmin, ymin, xmax, ymax)) in SVG coordinates."""
        names = [self.cmap[ord(c)] for c in text]
        s = size / self.upm
        advance = sum(self.hmtx[n][0] for n in names) * s
        if anchor == "middle":
            x -= advance / 2
        pen = SVGPathPen(self.glyphs, ntos=num)
        bounds = BoundsPen(self.glyphs)
        for n in names:
            m = (s, 0, 0, -s, x, baseline)
            self.glyphs[n].draw(TransformPen(pen, m))
            self.glyphs[n].draw(TransformPen(bounds, m))
            x += self.hmtx[n][0] * s
        return pen.getCommands(), bounds.bounds


def lettering(d, fill):
    """Sticker lettering: an ink shadow, then the fill over its own ink outline."""
    dx, dy = SHADOW
    return (
        f'<path d="{d}" transform="translate({dx} {dy})" fill="{INK}" stroke="{INK}" stroke-width="{OUTLINE}" stroke-linejoin="round"/>\n'
        f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="{OUTLINE}" stroke-linejoin="round" paint-order="stroke"/>'
    )


def pine(x, base, h, sw):
    """TITLE_SCENE's pine: a triangle 0.6 h wide."""
    w = 0.6 * h
    return (
        f'<polygon points="{num(x - w / 2)},{num(base)} {num(x)},{num(base - h)} {num(x + w / 2)},{num(base)}" '
        f'fill="{PINE}" stroke="{INK}" stroke-width="{num(sw)}" stroke-linejoin="round"/>'
    )


def flag(x, base, h, sw):
    """TITLE_SCENE's flag: an ink pole and a clay pennant, 48 x 28 on an 86-tall pole."""
    k = h / 86
    top = base - h
    return (
        f'<line x1="{num(x)}" y1="{num(base)}" x2="{num(x)}" y2="{num(top)}" stroke="{INK}" stroke-width="{num(sw * 1.4)}" stroke-linecap="round"/>'
        f'<path d="M{num(x)} {num(top + 2 * k)} L{num(x + 48 * k)} {num(top + 16 * k)} L{num(x)} {num(top + 30 * k)} Z" '
        f'fill="{CLAY}" stroke="{INK}" stroke-width="{num(sw)}" stroke-linejoin="round"/>'
    )


def sun(cx, cy, r, x0, x1):
    """TITLE_SCENE's striped sun: rings at 1, 0.75 and 0.5 of the radius, and four cream stripes
    across its lower half that thicken downward (8, 12, 16, 20 at y -30, 0, 32, 68 on a 170 sun)."""
    out = [f'<circle cx="{num(cx)}" cy="{num(cy)}" r="{num(r * k)}" fill="{c}"/>' for k, c in ((1, SUN), (0.75, SUNSET), (0.5, CLAY))]
    s = r / 170
    for off, h in ((-30, 8), (0, 12), (32, 16), (68, 20)):
        out.append(f'<rect x="{num(x0)}" y="{num(cy + off * s)}" width="{num(x1 - x0)}" height="{num(h * s)}" fill="{CREAM}"/>')
    return "".join(out)


def hill(x0, x1, y, bottom, wobble, fill, sw):
    """A rolling hill band from x0 to x1, its crest near y, filled down to `bottom`."""
    w = x1 - x0
    return (
        f'<path d="M{num(x0)} {num(y + wobble * 0.5)} C {num(x0 + 0.3 * w)} {num(y - wobble)}, {num(x0 + 0.55 * w)} {num(y - wobble * 0.2)}, '
        f'{num(x0 + 0.7 * w)} {num(y)} S {num(x0 + 0.9 * w)} {num(y - wobble * 0.7)}, {num(x1)} {num(y - wobble * 0.3)} '
        f'L {num(x1)} {num(bottom)} L {num(x0)} {num(bottom)} Z" fill="{fill}" stroke="{INK}" stroke-width="{num(sw)}"/>'
    )


def full_mark(font):
    size = 136
    _, b = font.path("Tee Time", size, 0, 0)
    x = 18 + OUTLINE / 2 - b[0]
    base1 = 18 + OUTLINE / 2 - b[1]
    tee, b1 = font.path("Tee Time", size, x, base1)
    base2 = base1 + 118
    links, b2 = font.path("Links", size, x + 40, base2)

    r = 106
    cx = b1[2] - 70
    cy = base2 - 50
    x0, x1 = cx - r, cx + r
    ring = 10
    sw = 4
    parts = [
        f'<circle cx="{num(cx + SHADOW[0])}" cy="{num(cy + SHADOW[1])}" r="{num(r + ring / 2)}" fill="{INK}"/>',
        f'<clipPath id="ttl-full-clip"><circle cx="{num(cx)}" cy="{num(cy)}" r="{num(r)}"/></clipPath>',
        '<g clip-path="url(#ttl-full-clip)">',
        f'<rect x="{num(x0)}" y="{num(cy - r)}" width="{num(2 * r)}" height="{num(2 * r)}" fill="{CREAM}"/>',
        sun(cx, cy + 0.06 * r, 0.8 * r, x0, x1),
        hill(x0, x1, cy + 0.42 * r, cy + r, 0.1 * r, HILL_MID, sw),
        pine(cx - 0.56 * r, cy + 0.62 * r, 0.66 * r, sw),
        pine(cx - 0.28 * r, cy + 0.64 * r, 0.86 * r, sw),
        pine(cx - 0.02 * r, cy + 0.62 * r, 0.56 * r, sw),
        hill(x0, x1, cy + 0.6 * r, cy + r, 0.07 * r, HILL_NEAR, sw),
        flag(cx + 0.42 * r, cy + 0.66 * r, 0.7 * r, sw),
        "</g>",
        f'<circle cx="{num(cx)}" cy="{num(cy)}" r="{num(r)}" fill="none" stroke="{INK}" stroke-width="{ring}"/>',
        lettering(tee, CREAM),
        lettering(links, SUN),
    ]
    w = max(b1[2], cx + r + ring / 2) + OUTLINE / 2 + SHADOW[0] + 8
    h = max(b2[3] + OUTLINE / 2, cy + r + ring / 2) + SHADOW[1] + 8
    return '<g id="ttl-full">\n' + "\n".join(parts) + "\n</g>", w, h


def compact_mark(font, ox):
    """A rounded-square sticker, 256 x 256 at x = ox: the sun over the hills, pines and the flag,
    with the name on a pine band."""
    pad, side, corner, edge = 10, 230, 40, 10
    x0, y0 = ox + pad, pad
    x1, y1 = x0 + side, y0 + side
    cx = (x0 + x1) / 2
    sw = 4
    band = y1 - 60
    name, _ = font.path("Tee Time Links", 25, cx, band + 39, anchor="middle")
    parts = [
        f'<rect x="{num(x0 + 4)}" y="{num(y0 + 8)}" width="{side}" height="{side}" rx="{corner}" fill="{INK}"/>',
        f'<clipPath id="ttl-mark-clip"><rect x="{num(x0)}" y="{y0}" width="{side}" height="{side}" rx="{corner}"/></clipPath>',
        '<g clip-path="url(#ttl-mark-clip)">',
        f'<rect x="{num(x0)}" y="{y0}" width="{side}" height="{side}" fill="{CREAM}"/>',
        sun(cx, y0 + 96, 84, x0, x1),
        hill(x0, x1, y0 + 122, band, 9, HILL_MID, sw),
        pine(x0 + 44, y0 + 146, 70, sw),
        pine(x0 + 74, y0 + 148, 92, sw),
        hill(x0, x1, y0 + 140, band, 6, HILL_NEAR, sw),
        flag(x0 + 170, y0 + 150, 66, sw),
        f'<rect x="{num(x0 - edge)}" y="{num(band)}" width="{side + 2 * edge}" height="{side}" fill="{PINE}" stroke="{INK}" stroke-width="8"/>',
        f'<path d="{name}" fill="{CREAM}"/>',
        "</g>",
        f'<rect x="{num(x0)}" y="{y0}" width="{side}" height="{side}" rx="{corner}" fill="none" stroke="{INK}" stroke-width="{edge}"/>',
    ]
    return '<g id="ttl-mark">\n' + "\n".join(parts) + "\n</g>"


def build(font_path):
    font = Font(font_path)
    full, w, h = full_mark(font)
    ox = w + 40
    mark = compact_mark(font, ox)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(w)} {num(h)}">
<!-- Tee Time Links. Generated by art/brand/tee_time_links.py; edit that, not this. Lettering: Shrikhand (SIL OFL 1.1), as outlines. -->
<!-- Two views: the root viewBox (#full) is the wordmark; #mark is the compact square mark. -->
<view id="full" viewBox="0 0 {num(w)} {num(h)}"/>
<view id="mark" viewBox="{num(ox)} 0 256 256"/>
{full}
{mark}
</svg>
"""


if __name__ == "__main__":
    svg = build(sys.argv[1])
    with open(sys.argv[2], "w", newline="\n") as f:
        f.write(svg)
    print(f"{sys.argv[2]}: {len(svg)} bytes")
