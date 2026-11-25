"""gce-routemap: draw the routing over the aerial, for review (docs/screens/m2/full-routing.jpg).

One pixel per meter over a stage's bounds, course-frame grid lines every 100 m (x yellow, z cyan).
Each hole's centerline and cart path are colored by its routing confidence; greens green, tees
magenta, bunkers orange, fairways white, ponds blue, connector paths cyan with a white casing.
The tee number sits at the back tee.
"""

from __future__ import annotations

import argparse
import math
import sys
import tomllib
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFont
from rasterio.windows import from_bounds
from shapely.geometry import LineString, Polygon

from . import layout
from .course import REPO
from .fetch import load_course

CONFIDENCE = {"high": (60, 230, 60), "medium": (250, 200, 20), "low": (240, 60, 50)}
NEUTRAL = (200, 200, 200)
CONNECTOR = (40, 230, 240)
SURFACE = {
    "green": (60, 230, 60),
    "tee": (230, 40, 230),
    "bunker": (250, 140, 20),
    "fairway": (255, 255, 255),
    "water": (40, 110, 255),
}


def _font(size: int) -> ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def aerial_crop(cfg: dict, folder: Path, bounds: list[float]) -> Image.Image:
    """The aerial resampled to 1 m pixels over bounds [x0, z0, x1, z1] (course frame)."""
    loc = cfg["location"]
    x0, z0, x1, z1 = bounds
    w, h = round(x1 - x0) + 1, round(z1 - z0) + 1
    with rasterio.open(folder / cfg["aerial"]["out"]) as src:
        win = from_bounds(
            loc["easting"] + x0,
            loc["northing"] - z1,
            loc["easting"] + x1,
            loc["northing"] - z0,
            src.transform,
        )
        rgb = src.read([1, 2, 3], window=win, out_shape=(3, h, w), boundless=True, fill_value=40)
    return Image.fromarray(np.moveaxis(rgb, 0, -1).astype(np.uint8), "RGB")


def draw(cfg: dict, folder: Path, stage: str) -> Image.Image:
    bounds = cfg["stages"][stage]["bounds"]
    holes = set(cfg["stages"][stage]["holes"])
    x0, z0 = bounds[0], bounds[1]
    img = aerial_crop(cfg, folder, bounds)
    d = ImageDraw.Draw(img)
    route_file = folder / "authoring" / "routing.toml"
    route = tomllib.loads(route_file.read_text(encoding="utf-8")) if route_file.exists() else {}
    conf = {int(k): v.get("confidence") for k, v in route.get("holes", {}).items()}
    conf.setdefault(1, "high")
    lines = {int(k): v["line"] for k, v in route.get("holes", {}).items()}

    def px(pts) -> list[tuple[float, float]]:
        return [(x - x0, z - z0) for x, z in pts]

    small = _font(11)
    for gx in range(math.ceil(bounds[0] / 100) * 100, int(bounds[2]) + 1, 100):
        d.line([(gx - x0, 0), (gx - x0, img.height)], fill=(240, 230, 60), width=1)
        d.text((gx - x0 + 3, 2), str(gx), fill=(240, 230, 60), font=small)
    for gz in range(math.ceil(bounds[1] / 100) * 100, int(bounds[3]) + 1, 100):
        d.line([(0, gz - z0), (img.width, gz - z0)], fill=(60, 220, 230), width=1)
        d.text((3, gz - z0 + 2), str(gz), fill=(60, 220, 230), font=small)

    feats = [f for f in layout.load_overrides(cfg, folder) if f.hole is None or f.hole in holes]
    for f in feats:
        color = SURFACE.get(f.surface)
        if color is None or not isinstance(f.geom, Polygon) or f.props.get("wade"):
            continue
        d.line(px(f.geom.exterior.coords), fill=color, width=1 if f.surface == "fairway" else 2)
    for n, line in lines.items():
        if n in holes:
            d.line(px(line), fill=CONFIDENCE.get(conf.get(n), NEUTRAL), width=3)
    for f in feats:
        if f.surface != "cartpath" or not isinstance(f.geom, LineString):
            continue
        pts = px(f.geom.coords)
        if f.hole is None:
            d.line(pts, fill=(255, 255, 255), width=5)
            d.line(pts, fill=CONNECTOR, width=3)
        else:
            d.line(pts, fill=CONFIDENCE.get(conf.get(f.hole), NEUTRAL), width=2)

    label = _font(14)
    for f in feats:
        if f.surface == "tee" and f.props.get("tee") == "blue" and f.hole in holes:
            c = f.geom.centroid
            x, y = c.x - x0 + 10, c.y - z0 + 8
            d.rectangle([x, y, x + 30, y + 20], fill=(0, 0, 0))
            d.text(
                (x + 15, y + 10),
                str(f.hole),
                fill=CONFIDENCE.get(conf.get(f.hole), NEUTRAL),
                font=label,
                anchor="mm",
            )

    legend = [
        ("Caswell Pines routing (tee number at the back tee)", (255, 255, 255)),
        ("high confidence", CONFIDENCE["high"]),
        ("medium confidence", CONFIDENCE["medium"]),
        ("low confidence", CONFIDENCE["low"]),
        ("connector cart path", CONNECTOR),
    ]
    lx, ly = 8, img.height - 22 * len(legend) - 12
    d.rectangle([lx, ly, lx + 330, img.height - 8], fill=(0, 0, 0))
    for k, (text, color) in enumerate(legend):
        d.text((lx + 8, ly + 6 + 22 * k), text, fill=color, font=_font(13))
    return img


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gce-routemap", description=__doc__.splitlines()[0])
    parser.add_argument("--course", required=True)
    parser.add_argument("--stage", default="full")
    parser.add_argument("--out", default=str(REPO / "docs" / "screens" / "m2" / "full-routing.jpg"))
    args = parser.parse_args(argv)
    cfg, folder = load_course(args.course)
    img = draw(cfg, folder, args.stage)
    img.save(args.out, quality=88)
    print(f"gce-routemap: {img.width}x{img.height} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
