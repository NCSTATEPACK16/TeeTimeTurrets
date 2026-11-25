"""Downloads, through curl so proxies, TLS and resume behave the same on a Mac and in the cloud.

Every saved source gets a manifest entry (what was asked, from where, its sha256), so later steps
can check they are reading exactly the committed or cached bytes.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tomllib
from collections.abc import Callable
from pathlib import Path

from . import osm

COURSES_DIR = Path(__file__).resolve().parents[2] / "courses"

Runner = Callable[[list[str]], None]


def load_course(course_id: str, courses_dir: Path = COURSES_DIR) -> tuple[dict, Path]:
    folder = courses_dir / course_id
    with (folder / "course.toml").open("rb") as f:
        return tomllib.load(f), folder


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def overpass(cfg: dict, folder: Path, run: Runner = _run) -> tuple[Path, dict]:
    """POST the course's query to Overpass, save the JSON snapshot and its manifest. Returns both."""
    loc = cfg["location"]
    o = cfg["osm"]
    query = osm.build_query(loc["lat"], loc["lon"], o["radius_m"], o["timeout_s"])
    out = folder / o["snapshot"]
    out.parent.mkdir(parents=True, exist_ok=True)
    query_file = out.with_suffix(".overpassql")
    query_file.write_text(query, encoding="utf-8")
    tmp = out.with_suffix(".part")
    run(
        [
            "curl",
            "--fail-with-body",
            "-sS",
            "--retry",
            "3",
            "--max-time",
            str(o["timeout_s"] + 60),
            "-A",
            o["user_agent"],
            "--data-urlencode",
            f"data@{query_file}",
            "-o",
            str(tmp),
            o["endpoint"],
        ]
    )
    raw = tmp.read_bytes()
    data = json.loads(raw)  # fails loudly on an HTML error page
    if "remark" in data and "error" in str(data["remark"]).lower():
        raise RuntimeError(f"Overpass error: {data['remark']}")
    tmp.replace(out)
    manifest = {
        "source": "OpenStreetMap via Overpass API",
        "license": "ODbL 1.0, (c) OpenStreetMap contributors",
        "endpoint": o["endpoint"],
        "query": query_file.name,
        "osmBase": (data.get("osm3s") or {}).get("timestamp_osm_base"),
        "elements": len(data.get("elements", [])),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    (out.parent / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return out, manifest


def curl_get(user_agent: str, run: Runner = _run) -> Callable[[str, Path], None]:
    """A Getter for aerial.fetch: GET url to dest, failing on HTTP errors."""

    def get(url: str, dest: Path) -> None:
        run(
            [
                "curl",
                "--fail",
                "-sS",
                "--retry",
                "3",
                "--max-time",
                "300",
                "-A",
                user_agent,
                "-o",
                str(dest),
                url,
            ]
        )

    return get


def resumable(
    url: str, dest: Path, size: int | None, user_agent: str, run: Runner = _run, tries: int = 60
) -> None:
    """Download with `curl -C -` until the file is complete (proxy restarts cut long transfers)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(tries):
        if size is not None and dest.exists() and dest.stat().st_size == size:
            return
        try:
            run(["curl", "-sS", "-L", "--fail", "-C", "-", "-A", user_agent, "-o", str(dest), url])
            if size is None or dest.stat().st_size == size:
                return
        except subprocess.CalledProcessError:
            continue
    raise RuntimeError(f"download of {url} did not complete")
