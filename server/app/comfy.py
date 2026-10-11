"""ComfyUI client: queue a workflow, wait for it, fetch the picture."""

from __future__ import annotations

import asyncio
import json
import math
import random
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

from .config import SERVER_DIR, Settings
from .errors import NotConfigured, ServiceError
from .schemas import IllustrationRequest
from .styles import build_prompts

POLL_INTERVAL_S = 1.0
SIZE_STEP = 64
MIN_SIZE = 256

# Values a custom workflow file may ask for. A string that is exactly one of
# the numeric tokens becomes a number; the text tokens are replaced in place.
NUMERIC_TOKENS = ("%seed%", "%width%", "%height%", "%steps%", "%cfg%")
TEXT_TOKENS = ("%prompt%", "%negative%", "%checkpoint%", "%sampler%", "%scheduler%")


def dimensions(aspect: float, base: int) -> tuple[int, int]:
    """Width and height with the model's native pixel area, snapped to the latent grid."""
    width = math.sqrt(base * base * aspect)
    height = width / aspect

    def snap(value: float) -> int:
        return max(MIN_SIZE, round(value / SIZE_STEP) * SIZE_STEP)

    return snap(width), snap(height)


def default_workflow(values: dict[str, Any]) -> dict[str, Any]:
    """Text-to-image with a single checkpoint: works for SD 1.5 and SDXL models."""
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": values["%checkpoint%"]}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": values["%prompt%"], "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": values["%negative%"], "clip": ["1", 1]}},
        "4": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": values["%width%"], "height": values["%height%"], "batch_size": 1},
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": values["%seed%"],
                "steps": values["%steps%"],
                "cfg": values["%cfg%"],
                "sampler_name": values["%sampler%"],
                "scheduler": values["%scheduler%"],
                "denoise": 1.0,
            },
        },
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "nebiru"}},
    }


def fill_workflow(node: Any, values: dict[str, Any]) -> Any:
    """Substitute tokens throughout a workflow loaded from a file."""
    if isinstance(node, dict):
        return {key: fill_workflow(value, values) for key, value in node.items()}
    if isinstance(node, list):
        return [fill_workflow(value, values) for value in node]
    if isinstance(node, str):
        if node in NUMERIC_TOKENS:
            return values[node]
        for token in TEXT_TOKENS:
            node = node.replace(token, str(values[token]))
    return node


def _checkpoint_names(info: dict[str, Any]) -> list[str]:
    try:
        spec = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"]
    except (KeyError, TypeError):
        return []
    if spec and isinstance(spec[0], list):
        return [name for name in spec[0] if isinstance(name, str)]
    # Newer ComfyUI describes a choice as ["COMBO", {"options": [...]}].
    if len(spec) > 1 and isinstance(spec[1], dict):
        return [name for name in spec[1].get("options", []) if isinstance(name, str)]
    return []


def _first_image(outputs: dict[str, Any]) -> dict[str, str] | None:
    for output in outputs.values():
        for image in output.get("images", []) if isinstance(output, dict) else []:
            if image.get("type") != "temp":
                return image
    return None


def _failure_message(entry: dict[str, Any]) -> str:
    for kind, detail in (entry.get("status") or {}).get("messages", []):
        if kind == "execution_error" and isinstance(detail, dict):
            node = detail.get("node_type") or "a node"
            return f"ComfyUI failed in {node}: {detail.get('exception_message', 'unknown error')}".strip()
    return "ComfyUI reported an error while drawing."


class ComfyUI:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client

    @property
    def _custom_workflow(self) -> Path | None:
        configured = self._settings.comfyui_workflow
        if not configured:
            return None
        path = Path(configured)
        return path if path.is_absolute() else SERVER_DIR / path

    async def _get(self, path: str, **kwargs: Any) -> httpx.Response:
        try:
            return await self._client.get(f"{self._settings.comfyui_url}{path}", **kwargs)
        except httpx.HTTPError:
            raise NotConfigured(f"ComfyUI is not reachable at {self._settings.comfyui_url}.") from None

    async def checkpoints(self) -> list[str]:
        response = await self._get("/object_info/CheckpointLoaderSimple", timeout=10.0)
        return _checkpoint_names(response.json()) if response.status_code == 200 else []

    async def _checkpoint(self) -> str:
        """The configured checkpoint, or the first one ComfyUI already has. Nothing is downloaded."""
        if self._settings.comfyui_checkpoint:
            return self._settings.comfyui_checkpoint
        names = await self.checkpoints()
        if not names:
            raise NotConfigured("ComfyUI has no checkpoint models installed.")
        return names[0]

    async def problem(self) -> str | None:
        """Why illustrations cannot be drawn, or None when ComfyUI is ready."""
        try:
            response = await self._get("/system_stats", timeout=3.0)
            if response.status_code != 200:
                return f"ComfyUI at {self._settings.comfyui_url} answered HTTP {response.status_code}."
            workflow = self._custom_workflow
            if workflow:
                return None if workflow.is_file() else f"The workflow file {workflow} does not exist."
            await self._checkpoint()
        except NotConfigured as error:
            return error.message
        return None

    async def _workflow(self, request: IllustrationRequest, seed: int) -> dict[str, Any]:
        settings = self._settings
        positive, negative = build_prompts(request.prompt, request.style_id, request.purpose)
        width, height = dimensions(request.aspect, settings.comfyui_base_size)
        custom = self._custom_workflow
        values: dict[str, Any] = {
            "%prompt%": positive,
            "%negative%": negative,
            "%seed%": seed,
            "%width%": width,
            "%height%": height,
            "%steps%": settings.comfyui_steps,
            "%cfg%": settings.comfyui_cfg,
            "%sampler%": settings.comfyui_sampler,
            "%scheduler%": settings.comfyui_scheduler,
            # A custom workflow names its own models, so only look one up when it asks.
            "%checkpoint%": settings.comfyui_checkpoint,
        }
        if custom is None:
            values["%checkpoint%"] = await self._checkpoint()
            return default_workflow(values)
        try:
            raw = custom.read_text()
            template = json.loads(raw)
        except (OSError, json.JSONDecodeError) as error:
            raise NotConfigured(f"The workflow file {custom} could not be read: {error}") from None
        if "%checkpoint%" in raw and not values["%checkpoint%"]:
            values["%checkpoint%"] = await self._checkpoint()
        return fill_workflow(template, values)

    async def generate(self, request: IllustrationRequest) -> tuple[bytes, int]:
        """Draw one picture. Returns the image bytes and the seed used."""
        settings = self._settings
        seed = request.seed if request.seed is not None else random.randrange(2**32)
        workflow = await self._workflow(request, seed)

        try:
            queued = await self._client.post(
                f"{settings.comfyui_url}/prompt",
                json={"prompt": workflow, "client_id": uuid.uuid4().hex},
                timeout=30.0,
            )
        except httpx.HTTPError:
            raise NotConfigured(f"ComfyUI is not reachable at {settings.comfyui_url}.") from None
        if queued.status_code != 200:
            try:
                reason = queued.json().get("error", {}).get("message") or queued.text[:300]
            except ValueError:
                reason = queued.text[:300]
            raise ServiceError(f"ComfyUI rejected the workflow: {reason}")
        prompt_id = queued.json().get("prompt_id")
        if not prompt_id:
            raise ServiceError("ComfyUI did not accept the job.")

        deadline = time.monotonic() + settings.comfyui_timeout_s
        while True:
            history = await self._get(f"/history/{prompt_id}", timeout=15.0)
            entry = history.json().get(prompt_id) if history.status_code == 200 else None
            if entry:
                if (entry.get("status") or {}).get("status_str") == "error":
                    raise ServiceError(_failure_message(entry))
                image = _first_image(entry.get("outputs") or {})
                if image:
                    break
                if (entry.get("status") or {}).get("completed"):
                    raise ServiceError("ComfyUI finished without producing an image.")
            if time.monotonic() > deadline:
                raise ServiceError(f"ComfyUI did not finish within {settings.comfyui_timeout_s:.0f} seconds.")
            await asyncio.sleep(POLL_INTERVAL_S)

        picture = await self._get(
            "/view",
            params={
                "filename": image["filename"],
                "subfolder": image.get("subfolder", ""),
                "type": image.get("type", "output"),
            },
            timeout=60.0,
        )
        if picture.status_code != 200 or not picture.content:
            raise ServiceError("ComfyUI drew the image but it could not be downloaded.")
        return picture.content, seed
