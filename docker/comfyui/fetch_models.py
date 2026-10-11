#!/usr/bin/env python3
"""Fetch the model files FLUX.1 Dev needs, once, into ComfyUI's models folder.

Runs before ComfyUI starts. Files already present are left alone, so later
starts need no network. A download interrupted by a restart resumes where it
stopped. Progress is written to a small JSON file that the Nebiru server
reads to tell the user how far along the first start is.

Standard library only, so it can run before anything else is installed.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

HF = "https://huggingface.co"
CHUNK = 1 << 20
PROGRESS_EVERY_S = 2.0
ATTEMPTS = 6
TIMEOUT_S = 60


@dataclass(frozen=True)
class Model:
    folder: str
    name: str
    url: str


def wanted(env: dict[str, str]) -> list[Model]:
    """The files to have on disk, from the environment. Each URL can be overridden for a mirror."""
    unet = env.get("FLUX_UNET_FILE") or "flux1-dev-Q5_K_S.gguf"
    t5 = env.get("FLUX_T5_FILE") or "t5xxl_fp8_e4m3fn.safetensors"
    clip_l = env.get("FLUX_CLIP_L_FILE") or "clip_l.safetensors"
    vae = env.get("FLUX_VAE_FILE") or "ae.safetensors"
    encoders = f"{HF}/comfyanonymous/flux_text_encoders/resolve/main"
    return [
        Model("diffusion_models", unet, env.get("FLUX_UNET_URL") or f"{HF}/city96/FLUX.1-dev-gguf/resolve/main/{unet}"),
        Model("text_encoders", t5, env.get("FLUX_T5_URL") or f"{encoders}/{t5}"),
        Model("text_encoders", clip_l, env.get("FLUX_CLIP_L_URL") or f"{encoders}/{clip_l}"),
        # The FLUX autoencoder. Black Forest Labs' own copy needs a login; this one is the same file.
        Model(
            "vae",
            vae,
            env.get("FLUX_VAE_URL")
            or f"{HF}/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors",
        ),
    ]


class _Redirects(urllib.request.HTTPRedirectHandler):
    """Follow redirects, but never carry the access token to a different host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None and urlsplit(newurl).netloc != urlsplit(req.full_url).netloc:
            redirected.remove_header("Authorization")
            redirected.unredirected_hdrs.pop("Authorization", None)
        return redirected


OPENER = urllib.request.build_opener(_Redirects)


def _request(url: str, token: str, start: int = 0, method: str = "GET") -> urllib.request.Request:
    request = urllib.request.Request(url, method=method, headers={"User-Agent": "nebiru-model-fetch"})
    if token and urlsplit(url).netloc.endswith("huggingface.co"):
        request.add_header("Authorization", f"Bearer {token}")
    if start > 0:
        request.add_header("Range", f"bytes={start}-")
    return request


def remote_size(url: str, token: str) -> int:
    """Size of a file in bytes, or 0 when the server will not say."""
    try:
        with OPENER.open(_request(url, token, method="HEAD"), timeout=TIMEOUT_S) as response:
            return int(response.headers.get("Content-Length") or 0)
    except (urllib.error.URLError, OSError, ValueError):
        return 0


class Progress:
    """Writes download progress where the Nebiru server can read it."""

    def __init__(self, path: Path | None, total: int) -> None:
        self._path = path
        self._total = total
        self._done = 0
        self._last = 0.0

    def _write(self, payload: dict) -> None:
        if self._path is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_suffix(".tmp")
        temporary.write_text(json.dumps({**payload, "updatedAt": time.time()}))
        os.replace(temporary, self._path)

    def advance(self, amount: int, name: str, force: bool = False) -> None:
        self._done += amount
        now = time.monotonic()
        if force or now - self._last >= PROGRESS_EVERY_S:
            self._last = now
            self._write({"state": "downloading", "file": name, "doneBytes": self._done, "totalBytes": self._total})

    def finish(self) -> None:
        self._write({"state": "ready"})

    def fail(self, message: str) -> None:
        self._write({"state": "error", "message": message})


def download(model: Model, target: Path, token: str, progress: Progress, log=print) -> None:
    """Download one file, resuming a partial one. Raises OSError when every attempt fails."""
    part = target.with_name(target.name + ".part")
    target.parent.mkdir(parents=True, exist_ok=True)
    progress.advance(part.stat().st_size if part.exists() else 0, model.name, force=True)
    failure: Exception | None = None

    for attempt in range(1, ATTEMPTS + 1):
        have = part.stat().st_size if part.exists() else 0
        try:
            with OPENER.open(_request(model.url, token, start=have), timeout=TIMEOUT_S) as response:
                resumed = response.status == 206
                if have and not resumed:
                    # The server ignored the range and is sending the whole file again.
                    progress.advance(-have, model.name)
                    have = 0
                with open(part, "ab" if resumed else "wb") as file:
                    while chunk := response.read(CHUNK):
                        file.write(chunk)
                        progress.advance(len(chunk), model.name)
            os.replace(part, target)
            progress.advance(0, model.name, force=True)
            return
        except urllib.error.HTTPError as error:
            if error.code == 416 and have:
                # Nothing left to send: the partial file was already complete.
                os.replace(part, target)
                return
            if error.code in (401, 403):
                raise OSError(
                    f"{model.name}: access denied (HTTP {error.code}). If the source needs a "
                    "Hugging Face login, set HF_TOKEN."
                ) from None
            if error.code == 404:
                raise OSError(f"{model.name}: not found at {model.url}") from None
            failure = error
        except (urllib.error.URLError, OSError) as error:
            failure = error
        log(f"  attempt {attempt} of {ATTEMPTS} failed ({failure}); retrying", flush=True)
        time.sleep(min(5 * attempt, 30))

    raise OSError(f"{model.name}: download failed after {ATTEMPTS} attempts ({failure})")


def main(env: dict[str, str] | None = None, log=print) -> int:
    env = dict(os.environ if env is None else env)
    models_dir = Path(env.get("NEBIRU_MODELS_DIR") or "/opt/ComfyUI/models")
    status = Path(env["NEBIRU_MODEL_STATUS_FILE"]) if env.get("NEBIRU_MODEL_STATUS_FILE") else models_dir / ".nebiru" / "download.json"
    token = env.get("HF_TOKEN", "")
    models = wanted(env)
    missing = [m for m in models if not (models_dir / m.folder / m.name).is_file()]

    if not missing:
        log("All model files are present.", flush=True)
        Progress(status, 0).finish()
        return 0
    if env.get("NEBIRU_SKIP_MODEL_DOWNLOAD", "").lower() in ("1", "true", "yes"):
        names = ", ".join(f"{m.folder}/{m.name}" for m in missing)
        log(f"Model download is switched off. Missing: {names}", flush=True)
        return 0

    sizes = {m.name: remote_size(m.url, token) for m in missing}
    total = sum(sizes.values())
    log(f"Downloading {len(missing)} model file(s), {total / 1e9:.1f} GB in all:", flush=True)
    progress = Progress(status, total)
    try:
        for model in missing:
            log(f"- {model.folder}/{model.name} ({sizes[model.name] / 1e9:.2f} GB)", flush=True)
            download(model, models_dir / model.folder / model.name, token, progress, log)
    except OSError as error:
        log(f"Model download failed: {error}", flush=True)
        progress.fail(str(error))
        return 1
    progress.finish()
    log("Model files are ready.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
