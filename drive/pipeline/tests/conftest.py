from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
COMMITTED = REPO / "apps" / "web" / "public" / "levels" / "dummy-01"


def run_dummy(out: Path, seed: int = 1) -> subprocess.CompletedProcess:
    """Run the real CLI entry point in a fresh interpreter."""
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from gcs_pipeline.cli import dummy_main; sys.exit(dummy_main())",
            "--out",
            str(out),
            "--seed",
            str(seed),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.fixture(scope="session")
def generated(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("dummy-a")
    run_dummy(out)
    return out
