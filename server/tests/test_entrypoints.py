"""The container entrypoints, run with stand-ins for the commands they call.

They start as root, fix ownership of the mounted folders and hand over to the
configured user. That user can be root itself (PUID=0, as on a server where
everything is root-owned), which must not send the script round in circles.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

DOCKER = Path(__file__).resolve().parents[2] / "docker"

# setpriv stand-in: record the user it was asked for, then run the command, still as "root".
SETPRIV = """#!/bin/sh
echo "setpriv $2 $4" >> "$CALLS"
shift 5
exec "$@"
"""


@pytest.fixture
def sandbox(tmp_path: Path):
    """Fake commands on PATH, each appending what it was asked to do to a log."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "calls.log"
    calls.touch()

    def command(name: str, body: str) -> None:
        path = bin_dir / name
        path.write_text(body)
        path.chmod(0o755)

    command("setpriv", SETPRIV)
    command("python", '#!/bin/sh\necho "python $*" >> "$CALLS"\n')
    command("uvicorn", '#!/bin/sh\necho "uvicorn $*" >> "$CALLS"\n')
    command("find", "#!/bin/sh\nexit 0\n")

    def run(script: Path, *args: str, uid: str, **env: str) -> list[str]:
        command("id", f"#!/bin/sh\necho {uid}\n")
        subprocess.run(
            ["sh", str(script), *args],
            env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "CALLS": str(calls), **env},
            check=True,
            timeout=20,  # an entrypoint that loops must fail the test, not hang it
        )
        return calls.read_text().splitlines()

    return tmp_path, run


@pytest.mark.parametrize("puid", ["0", "1000"])
def test_comfyui_entrypoint_starts_comfyui_once(sandbox, puid: str) -> None:
    tmp_path, run = sandbox
    data = tmp_path / "data"
    calls = run(
        DOCKER / "comfyui" / "entrypoint.sh",
        uid="0",
        PUID=puid,
        PGID=puid,
        NEBIRU_MODELS_DIR=str(tmp_path / "models"),
        COMFYUI_DATA_DIR=str(data),
        COMFYUI_ARGS="--cache-none --reserve-vram 2",
    )
    assert calls[0] == f"setpriv {puid} {puid}"
    assert calls[1] == "python /opt/nebiru/fetch_models.py"
    assert calls[2].startswith("python /opt/ComfyUI/main.py --listen 0.0.0.0 --port 8188")
    assert calls[2].endswith("--cache-none --reserve-vram 2")
    assert f"--output-directory {data}/output" in calls[2]
    assert len(calls) == 3
    assert all((data / name).is_dir() for name in ("output", "input", "temp", "user"))


def test_comfyui_entrypoint_started_as_an_ordinary_user_skips_the_root_step(sandbox) -> None:
    tmp_path, run = sandbox
    calls = run(
        DOCKER / "comfyui" / "entrypoint.sh",
        uid="1000",
        NEBIRU_MODELS_DIR=str(tmp_path / "models"),
        COMFYUI_DATA_DIR=str(tmp_path / "data"),
    )
    assert [call.split()[0] for call in calls] == ["python", "python"]


@pytest.mark.parametrize("puid", ["0", "1000"])
def test_app_entrypoint_runs_the_server_once(sandbox, puid: str) -> None:
    tmp_path, run = sandbox
    calls = run(
        DOCKER / "app" / "entrypoint.sh",
        "uvicorn",
        "app.main:app",
        uid="0",
        PUID=puid,
        PGID=puid,
        NEBIRU_DATA_DIR=str(tmp_path / "data"),
    )
    assert calls == [f"setpriv {puid} {puid}", "uvicorn app.main:app"]
