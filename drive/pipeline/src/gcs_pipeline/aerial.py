"""Aerial orthoimagery for tracing: fetch tiles from an ArcGIS ImageServer and mosaic one GeoTIFF.

The image is a tracing base for overrides.geojson only. It is never part of a packet. Tiles are
requested in UTM (bboxSR = imageSR = the course EPSG) and georeferenced from the requested box,
so the result does not depend on whether the server embeds georeferencing.
"""

from __future__ import annotations

import hashlib
import json
import math
import warnings
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

# run(url, dest) downloads url to dest (bytes); fetch.py supplies a curl-based one.
Getter = Callable[[str, Path], None]


def service_ok(info: dict) -> bool:
    """True when an ImageServer `?f=json` answer describes a usable, token-free service."""
    return "error" not in info and info.get("bandCount", 0) >= 3


def tile_boxes(west: float, north: float, size_m: float, pixel_m: float, tile_px: int):
    """Yield (row, col, (xmin, ymin, xmax, ymax), width_px, height_px) covering the square."""
    total = round(size_m / pixel_m)
    n = math.ceil(total / tile_px)
    for r in range(n):
        for c in range(n):
            w = min(tile_px, total - c * tile_px)
            h = min(tile_px, total - r * tile_px)
            x0 = west + c * tile_px * pixel_m
            y1 = north - r * tile_px * pixel_m
            yield r, c, (x0, y1 - h * pixel_m, x0 + w * pixel_m, y1), w, h


def export_url(
    service: str, box: tuple[float, float, float, float], w: int, h: int, epsg: int, bands: str
) -> str:
    params = {
        "bbox": ",".join(f"{v:.3f}" for v in box),
        "bboxSR": epsg,
        "imageSR": epsg,
        "size": f"{w},{h}",
        "format": "tiff",
        "pixelType": "U8",
        "bandIds": bands,
        "interpolation": "RSP_BilinearInterpolation",
        "f": "image",
    }
    return f"{service}/exportImage?{urlencode(params)}"


def fetch(cfg: dict, folder: Path, get: Getter, work: Path) -> tuple[Path, dict]:
    """Try each configured source, mosaic its tiles into cfg['aerial']['out']. Returns path, manifest."""
    a = cfg["aerial"]
    loc = cfg["location"]
    epsg = loc["epsg"]
    ox, oz = a["center_offset_m"]
    half = a["size_m"] / 2
    west = loc["easting"] + ox - half
    north = loc["northing"] - oz + half
    work.mkdir(parents=True, exist_ok=True)
    errors = []
    for source in a["sources"]:
        info_path = work / "info.json"
        try:
            get(f"{source['url']}?f=json", info_path)
            info = json.loads(info_path.read_text(encoding="utf-8"))
        except Exception as err:  # unreachable host, HTTP error, HTML error page
            code = getattr(err, "returncode", None)
            errors.append(f"{source['name']}: " + (f"curl exit {code}" if code is not None else str(err)))
            continue
        if not service_ok(info):
            errors.append(
                f"{source['name']}: {info.get('error', {}).get('message', 'not a 3-band image service')}"
            )
            continue
        total = round(a["size_m"] / a["pixel_m"])
        mosaic = np.zeros((3, total, total), dtype=np.uint8)
        for r, c, box, w, h in tile_boxes(west, north, a["size_m"], a["pixel_m"], a["tile_px"]):
            tile_path = work / f"tile_{r}_{c}.tif"
            get(export_url(source["url"], box, w, h, epsg, source["bands"]), tile_path)
            with warnings.catch_warnings():
                # Tiles are placed from the requested box, so missing georeferencing is fine.
                warnings.simplefilter("ignore", NotGeoreferencedWarning)
                with MemoryFile(tile_path.read_bytes()) as mem, mem.open() as t:
                    data = t.read()
            if data.shape[0] < 3 or data.shape[1:] != (h, w):
                raise RuntimeError(
                    f"{source['name']}: tile {r},{c} came back {data.shape}, expected (3, {h}, {w})"
                )
            y0, x0 = r * a["tile_px"], c * a["tile_px"]
            mosaic[:, y0 : y0 + h, x0 : x0 + w] = data[:3]
        out = folder / a["out"]
        out.parent.mkdir(parents=True, exist_ok=True)
        profile = {
            "driver": "GTiff",
            "width": total,
            "height": total,
            "count": 3,
            "dtype": "uint8",
            "crs": f"EPSG:{epsg}",
            "transform": from_origin(west, north, a["pixel_m"], a["pixel_m"]),
            "compress": "jpeg",
            "jpeg_quality": 88,
            "photometric": "ycbcr",
            "tiled": True,
            "blockxsize": 512,
            "blockysize": 512,
        }
        with rasterio.open(out, "w", **profile) as dst:
            dst.write(mosaic)
        manifest = {
            "source": source["name"],
            "service": source["url"],
            "serviceDescription": (info.get("description") or info.get("serviceDescription") or "")[:500],
            "copyright": info.get("copyrightText", ""),
            "epsg": epsg,
            "bounds": [west, north - a["size_m"], west + a["size_m"], north],
            "pixelM": a["pixel_m"],
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "skipped": errors,
        }
        (out.parent / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return out, manifest
    raise RuntimeError("no aerial source worked:\n  " + "\n  ".join(errors))
