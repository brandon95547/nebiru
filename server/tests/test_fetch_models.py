"""The model downloader that runs inside the ComfyUI container."""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "docker" / "comfyui" / "fetch_models.py"
spec = importlib.util.spec_from_file_location("fetch_models", SCRIPT)
fetch_models = importlib.util.module_from_spec(spec)
sys.modules["fetch_models"] = fetch_models  # dataclasses look their module up by name
spec.loader.exec_module(fetch_models)

FILES = {
    "/unet.gguf": bytes(range(256)) * 4000,  # ~1 MB, so it spans several chunks
    "/t5.safetensors": b"t5 " * 5000,
    "/clip_l.safetensors": b"clip " * 100,
    "/ae.safetensors": b"vae " * 100,
}


class Origin:
    """A small file server that honours Range requests, like Hugging Face's."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        self.ignore_range = False
        origin = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:
                pass

            def _serve(self, body: bool) -> None:
                origin.requests.append((self.command, self.path, dict(self.headers)))
                data = FILES.get(self.path)
                if data is None:
                    self.send_error(404)
                    return
                start = 0
                header = self.headers.get("Range")
                if header and not origin.ignore_range:
                    start = int(header.removeprefix("bytes=").split("-")[0])
                    if start >= len(data):
                        self.send_error(416)
                        return
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
                else:
                    self.send_response(200)
                self.send_header("Content-Length", str(len(data) - start))
                self.end_headers()
                if body:
                    self.wfile.write(data[start:])

            def do_GET(self) -> None:
                self._serve(body=True)

            def do_HEAD(self) -> None:
                self._serve(body=False)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def gets(self) -> list[str]:
        return [path for method, path, _ in self.requests if method == "GET"]


@pytest.fixture
def origin(monkeypatch):
    server = Origin()
    monkeypatch.setattr(fetch_models.time, "sleep", lambda _: None)
    yield server
    server.server.shutdown()


def environment(origin: Origin, models: Path, **extra: str) -> dict[str, str]:
    return {
        "NEBIRU_MODELS_DIR": str(models),
        "FLUX_UNET_FILE": "unet.gguf",
        "FLUX_UNET_URL": f"{origin.url}/unet.gguf",
        "FLUX_T5_FILE": "t5.safetensors",
        "FLUX_T5_URL": f"{origin.url}/t5.safetensors",
        "FLUX_CLIP_L_URL": f"{origin.url}/clip_l.safetensors",
        "FLUX_VAE_URL": f"{origin.url}/ae.safetensors",
        **extra,
    }


def quiet(*args, **kwargs) -> None:
    pass


def test_downloads_every_file_into_comfys_folders(origin: Origin, tmp_path: Path) -> None:
    assert fetch_models.main(environment(origin, tmp_path), log=quiet) == 0
    assert (tmp_path / "diffusion_models" / "unet.gguf").read_bytes() == FILES["/unet.gguf"]
    assert (tmp_path / "text_encoders" / "t5.safetensors").read_bytes() == FILES["/t5.safetensors"]
    assert (tmp_path / "text_encoders" / "clip_l.safetensors").read_bytes() == FILES["/clip_l.safetensors"]
    assert (tmp_path / "vae" / "ae.safetensors").read_bytes() == FILES["/ae.safetensors"]
    assert not list(tmp_path.rglob("*.part"))
    assert json.loads((tmp_path / ".nebiru" / "download.json").read_text())["state"] == "ready"


def test_a_second_start_downloads_nothing(origin: Origin, tmp_path: Path) -> None:
    fetch_models.main(environment(origin, tmp_path), log=quiet)
    origin.requests.clear()
    assert fetch_models.main(environment(origin, tmp_path), log=quiet) == 0
    assert origin.requests == []  # works with no network at all


def test_an_interrupted_download_resumes_where_it_stopped(origin: Origin, tmp_path: Path) -> None:
    data = FILES["/unet.gguf"]
    part = tmp_path / "diffusion_models" / "unet.gguf.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(data[:300_000])

    assert fetch_models.main(environment(origin, tmp_path), log=quiet) == 0
    assert (tmp_path / "diffusion_models" / "unet.gguf").read_bytes() == data
    ranged = [headers.get("Range") for method, path, headers in origin.requests if method == "GET" and path == "/unet.gguf"]
    assert ranged == ["bytes=300000-"]


def test_a_server_that_ignores_the_range_still_yields_a_whole_file(origin: Origin, tmp_path: Path) -> None:
    origin.ignore_range = True
    part = tmp_path / "diffusion_models" / "unet.gguf.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(b"stale partial data")
    assert fetch_models.main(environment(origin, tmp_path), log=quiet) == 0
    assert (tmp_path / "diffusion_models" / "unet.gguf").read_bytes() == FILES["/unet.gguf"]


def test_a_partial_file_that_was_already_complete_is_kept(origin: Origin, tmp_path: Path) -> None:
    part = tmp_path / "vae" / "ae.safetensors.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(FILES["/ae.safetensors"])
    assert fetch_models.main(environment(origin, tmp_path), log=quiet) == 0
    assert (tmp_path / "vae" / "ae.safetensors").read_bytes() == FILES["/ae.safetensors"]


def test_a_missing_file_fails_clearly_and_is_recorded(origin: Origin, tmp_path: Path) -> None:
    env = environment(origin, tmp_path, FLUX_UNET_URL=f"{origin.url}/nope.gguf")
    assert fetch_models.main(env, log=quiet) == 1
    status = json.loads((tmp_path / ".nebiru" / "download.json").read_text())
    assert status["state"] == "error" and "not found" in status["message"]


def test_download_can_be_switched_off(origin: Origin, tmp_path: Path) -> None:
    assert fetch_models.main(environment(origin, tmp_path, NEBIRU_SKIP_MODEL_DOWNLOAD="1"), log=quiet) == 0
    assert origin.requests == []
    assert not (tmp_path / "diffusion_models").exists()


def test_progress_counts_bytes_across_all_files(origin: Origin, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(fetch_models, "PROGRESS_EVERY_S", 0)
    seen: list[dict] = []
    original = fetch_models.Progress._write

    def record(self, payload: dict) -> None:
        seen.append(payload)
        original(self, payload)

    monkeypatch.setattr(fetch_models.Progress, "_write", record)
    fetch_models.main(environment(origin, tmp_path), log=quiet)
    total = sum(len(data) for data in FILES.values())
    downloading = [p for p in seen if p["state"] == "downloading"]
    assert {p["totalBytes"] for p in downloading} == {total}
    assert downloading[-1]["doneBytes"] == total
    assert [p["doneBytes"] for p in downloading] == sorted(p["doneBytes"] for p in downloading)


def test_the_default_sources_are_the_quantized_flux_files() -> None:
    models = {m.name: m for m in fetch_models.wanted({"FLUX_UNET_FILE": "flux1-dev-Q4_K_S.gguf"})}
    assert models["flux1-dev-Q4_K_S.gguf"].url == "https://huggingface.co/city96/FLUX.1-dev-gguf/resolve/main/flux1-dev-Q4_K_S.gguf"
    assert models["flux1-dev-Q4_K_S.gguf"].folder == "diffusion_models"
    assert models["t5xxl_fp8_e4m3fn.safetensors"].folder == "text_encoders"
    assert models["ae.safetensors"].folder == "vae"


def test_the_access_token_goes_only_to_hugging_face(origin: Origin, tmp_path: Path) -> None:
    fetch_models.main(environment(origin, tmp_path, HF_TOKEN="secret-token"), log=quiet)
    assert all("Authorization" not in headers for _, _, headers in origin.requests)
    request = fetch_models._request("https://huggingface.co/x/y/resolve/main/f", "secret-token")
    assert request.get_header("Authorization") == "Bearer secret-token"
