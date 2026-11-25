"""Command-line entry points."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from . import aerial, course, fetch, osm
from . import report as report_mod
from .dem import NodeGrid, crop_source
from .dummy import generate
from .packet import sha256, write_packet
from .review_h13 import generate as generate_review_h13


def dummy_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gce-dummy", description="Write the synthetic M0 level packet.")
    parser.add_argument(
        "--out", type=Path, required=True, help="output directory, e.g. ../apps/web/public/levels/dummy-01"
    )
    parser.add_argument("--seed", type=int, default=1, help="noise seed (default 1)")
    args = parser.parse_args(argv)

    packet = generate(seed=args.seed)
    files = write_packet(args.out, packet)
    course = packet.course
    grid = course["grid"]
    size = f"{grid['width']}x{grid['height']} nodes"
    print(f"gce-dummy: wrote {course['id']} to {args.out} ({size}, seed {args.seed})")
    for name in sorted(files):
        data = files[name]
        print(f"  {name:<16} {len(data):>9} B  sha256 {sha256(data)[:16]}")
    trees = sum(s["count"] for s in course["scatter"]["species"])
    hm = packet.heights_m
    level = course["water"][0]["level"]
    print(f"  heights {hm.min():.3f}..{hm.max():.3f} m, {trees} trees, pond level {level} m")
    return 0


def review_h13_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gce-review-h13", description="Write the synthetic hole-13 water review packet (not measured)."
    )
    parser.add_argument(
        "--out", type=Path, required=True, help="output directory, e.g. ../apps/web/public/levels/review-h13"
    )
    parser.add_argument("--seed", type=int, default=13, help="noise seed (default 13)")
    args = parser.parse_args(argv)

    packet = generate_review_h13(seed=args.seed)
    files = write_packet(args.out, packet)
    course = packet.course
    print(f"gce-review-h13: wrote {course['id']} to {args.out} (seed {args.seed})")
    for name in sorted(files):
        print(f"  {name:<16} {len(files[name]):>9} B  sha256 {sha256(files[name])[:16]}")
    pond = course["water"][0]
    print(f"  pond level {pond['level']} m, outline {len(pond['polygon'])} vertices")
    return 0


def fetch_osm_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gce-fetch-osm", description="Save the course's OpenStreetMap snapshot from Overpass."
    )
    parser.add_argument(
        "--course", required=True, help="course folder under pipeline/courses, e.g. tee-time-links"
    )
    args = parser.parse_args(argv)

    cfg, folder = fetch.load_course(args.course)
    try:
        out, manifest = fetch.overpass(cfg, folder)
    except subprocess.CalledProcessError as err:
        print(
            f"gce-fetch-osm: curl exit {err.returncode} from {cfg['osm']['endpoint']}; nothing saved. "
            "Run it on a machine that can reach Overpass.",
            file=sys.stderr,
        )
        return 1
    print(f"gce-fetch-osm: wrote {out} ({manifest['elements']} elements, OSM base {manifest['osmBase']})")
    print(json.dumps(osm.coverage(osm.parse(json.loads(out.read_text(encoding="utf-8")))), indent=2))
    return 0


def fetch_aerial_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gce-fetch-aerial", description="Save the course's aerial orthoimage (a tracing base)."
    )
    parser.add_argument(
        "--course", required=True, help="course folder under pipeline/courses, e.g. tee-time-links"
    )
    args = parser.parse_args(argv)

    cfg, folder = fetch.load_course(args.course)
    work = folder / "aerial" / ".tiles"
    try:
        out, manifest = aerial.fetch(cfg, folder, fetch.curl_get(cfg["osm"]["user_agent"]), work)
    except (RuntimeError, subprocess.CalledProcessError) as err:
        print(f"gce-fetch-aerial: {err}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    size = out.stat().st_size / 1e6
    print(f"gce-fetch-aerial: wrote {out} ({size:.1f} MB) from {manifest['source']}")
    for skipped in manifest["skipped"]:
        print(f"  skipped {skipped}")
    return 0


def course_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gce-course", description="Build a real course's level packet.")
    parser.add_argument("--course", required=True, help="course folder under pipeline/courses")
    parser.add_argument("--stage", required=True, help="stage name from course.toml, e.g. hole1 or full")
    parser.add_argument(
        "--out", type=Path, required=True, help="packet folder, e.g. ../apps/web/public/levels/<id>"
    )
    parser.add_argument(
        "--report", type=Path, default=None, help="report folder (default pipeline/reports/<id>)"
    )
    args = parser.parse_args(argv)

    cfg, folder = fetch.load_course(args.course)
    dem_path = course.REPO / cfg["dem"]["course"]
    packet, report = course.build(cfg, folder, args.stage, dem_path)
    files = write_packet(args.out, packet)
    out_report = args.report or (course.REPO / "pipeline" / "reports" / cfg["id"])
    report_mod.write(out_report, packet, report)
    print(f"gce-course: wrote {cfg['id']} stage {args.stage} to {args.out}")
    for name in sorted(files):
        print(f"  {name:<16} {len(files[name]):>9} B  sha256 {sha256(files[name])[:16]}")
    s = report["sculpt"]
    lo, hi = report["relief"]
    print(f"  grid {report['grid'][0]}x{report['grid'][1]}, relief {lo:.2f}..{hi:.2f} m")
    embank = report["embankmentNodesAfterPaths"]
    print(f"  max green slope {s['maxGreenSlope']:.4f}, embankment nodes {embank}")
    print(
        f"  driveStart run {report['driveStart']['runM']:.0f} m, trees {report['trees']}, report {out_report}"
    )
    return 0


def fetch_dem_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gce-fetch-dem", description="Download, extract and crop the course DEM."
    )
    parser.add_argument("--course", required=True, help="course folder under pipeline/courses")
    args = parser.parse_args(argv)
    cfg, _ = fetch.load_course(args.course)
    d = cfg["dem"]
    root = course.REPO
    out = root / d["course"]
    if out.exists():
        print(f"gce-fetch-dem: {out} already there")
        return 0
    zip_path = root / d["zip"]
    fetch.resumable(d["url"], zip_path, d["zip_bytes"], cfg["osm"]["user_agent"])
    fetch.resumable(d["horizon_url"], root / d["horizon_zip"], None, cfg["osm"]["user_agent"])
    work = out.parent / "extract"
    work.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["unzip", "-o", "-q", str(zip_path), "-d", str(work)], check=True
    )  # Deflate64: needs unzip
    (tif,) = work.glob("*.tif")
    loc = cfg["location"]
    n = round(d["crop_size_m"]) + 1
    grid = NodeGrid(loc["epsg"], loc["easting"], loc["northing"], n, n)
    crop_source(tif, out, grid, margin=d["crop_margin_m"])
    shutil.rmtree(work)
    print(f"gce-fetch-dem: wrote {out} ({out.stat().st_size / 1e6:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(dummy_main())
