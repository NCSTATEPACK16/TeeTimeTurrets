"""aerial.py against a fake ImageServer: source fallback, tiling, mosaic placement, georeferencing."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest
import rasterio
from rasterio.io import MemoryFile

from gcs_pipeline import aerial, fetch

# The fake server's tiles carry no georeferencing, like some real ImageServers.
pytestmark = pytest.mark.filterwarnings("ignore::rasterio.errors.NotGeoreferencedWarning")


def _cfg(**over) -> dict:
    cfg, _ = fetch.load_course("tee-time-links")
    a = dict(cfg["aerial"]) | {"size_m": 100.0, "pixel_m": 1.0, "tile_px": 40, "center_offset_m": [0.0, 0.0]}
    a |= over
    return cfg | {"aerial": a}


def _tiff(w: int, h: int, fill) -> bytes:
    """A 4-band tile whose red = column index into the mosaic and green = row index (mod 256)."""
    with MemoryFile() as mem:
        with mem.open(driver="GTiff", width=w, height=h, count=4, dtype="uint8") as t:
            t.write(fill(w, h))
        return mem.read()


class FakeServer:
    def __init__(self, infos: dict[str, dict]) -> None:
        self.infos = infos
        self.urls: list[str] = []

    def __call__(self, url: str, dest: Path) -> None:
        self.urls.append(url)
        base, _, _ = url.partition("?")
        if url.endswith("?f=json"):
            info = self.infos.get(base)
            if info is None:
                raise RuntimeError("connection refused")
            dest.write_text(json.dumps(info))
            return
        q = parse_qs(urlparse(url).query)
        w, h = (int(v) for v in q["size"][0].split(","))
        xmin, _, _, ymax = (float(v) for v in q["bbox"][0].split(","))

        def fill(w: int, h: int) -> np.ndarray:
            cols = (np.arange(w) + round(xmin - self.west)) % 256
            rows = (np.arange(h) + round(self.north - ymax)) % 256
            out = np.zeros((4, h, w), dtype=np.uint8)
            out[0] = cols[None, :]
            out[1] = rows[:, None]
            out[2] = 7
            return out

        dest.write_bytes(_tiff(w, h, fill))


def test_tile_boxes_cover_the_square_exactly() -> None:
    boxes = list(aerial.tile_boxes(1000.0, 2000.0, 100.0, 1.0, 40))
    assert len(boxes) == 9
    assert sum(w * h for *_, w, h in boxes) == 100 * 100
    _, _, box, w, h = boxes[-1]
    assert (w, h) == (20, 20) and box == (1080.0, 1900.0, 1100.0, 1920.0)


def test_fetch_falls_back_and_mosaics(tmp_path: Path) -> None:
    cfg = _cfg()
    urls = [s["url"] for s in cfg["aerial"]["sources"]]
    server = FakeServer(
        {
            urls[0]: {"error": {"code": 499, "message": "Token Required"}},
            urls[2]: {"bandCount": 4, "copyrightText": "NC OneMap"},
        }
    )
    loc = cfg["location"]
    server.west = loc["easting"] - 50.0
    server.north = loc["northing"] + 50.0
    out, manifest = aerial.fetch(cfg, tmp_path, server, tmp_path / "work")
    assert manifest["source"] == cfg["aerial"]["sources"][2]["name"]
    assert len(manifest["skipped"]) == 2 and "Token Required" in manifest["skipped"][0]
    export = [u for u in server.urls if "exportImage" in u]
    assert len(export) == 9 and all("bboxSR=32617" in u and "bandIds=0%2C1%2C2" in u for u in export)
    with rasterio.open(out) as img:
        assert img.crs.to_epsg() == 32617 and (img.width, img.height, img.count) == (100, 100, 3)
        assert img.transform.c == pytest.approx(server.west) and img.transform.f == pytest.approx(
            server.north
        )
        data = img.read()
    # JPEG is lossy, so compare the gradients loosely: red rises east, green rises south.
    assert abs(int(data[0, 50, 90]) - 90) <= 4 and abs(int(data[1, 90, 50]) - 90) <= 4
    assert json.loads((out.parent / "manifest.json").read_text())["sha256"] == manifest["sha256"]


def test_fetch_reports_every_failed_source(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="no aerial source worked") as err:
        aerial.fetch(_cfg(), tmp_path, FakeServer({}), tmp_path / "work")
    assert str(err.value).count("connection refused") == 4
    assert not (tmp_path / "aerial" / "ortho.tif").exists()
