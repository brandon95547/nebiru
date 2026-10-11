"""Settings, read once from the environment (and server/.env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent.parent


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    return float(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    deepseek_api_key: str
    deepseek_base_url: str
    # No built-in default: a hardcoded model name is only right until the
    # provider retires it, so the name always comes from the environment.
    deepseek_model: str
    deepseek_timeout_s: float
    deepseek_max_retries: int
    chapter_words: int

    comfyui_url: str
    comfyui_checkpoint: str
    comfyui_workflow: str
    comfyui_base_size: int
    comfyui_steps: int
    comfyui_cfg: float
    comfyui_sampler: str
    comfyui_scheduler: str
    comfyui_timeout_s: float

    data_dir: Path

    # Which built-in workflow draws the pictures: "checkpoint" (SD 1.5 / SDXL in a
    # single checkpoint file) or "flux" (FLUX.1 Dev as a quantized GGUF).
    comfyui_pipeline: str = "checkpoint"
    flux_unet: str = ""
    flux_clip_l: str = "clip_l.safetensors"
    flux_t5: str = "t5xxl_fp8_e4m3fn.safetensors"
    flux_vae: str = "ae.safetensors"
    flux_guidance: float = 3.5

    # Model used to read uploaded page images. Blank = the writing model. Not every
    # model looks at images, so this can name one that does.
    deepseek_vision_model: str = ""

    # The built web app, when this server also serves it (the Docker image does).
    static_dir: Path | None = None
    # Progress file written by the ComfyUI container while it downloads models.
    model_status_file: Path | None = None

    @property
    def images_dir(self) -> Path:
        return self.data_dir / "images"

    @property
    def books_dir(self) -> Path:
        return self.data_dir / "books"

    @property
    def text_problem(self) -> str | None:
        """Why the writing service cannot run, or None when it is configured."""
        if not self.deepseek_api_key:
            return "DEEPSEEK_API_KEY is not set."
        if not self.deepseek_model:
            return "DEEPSEEK_MODEL is not set."
        return None


def _path(name: str) -> Path | None:
    raw = os.environ.get(name, "").strip()
    return Path(raw) if raw else None


def load_settings() -> Settings:
    load_dotenv(SERVER_DIR / ".env")
    env = os.environ
    data_dir = Path(env.get("NEBIRU_DATA_DIR", "").strip() or SERVER_DIR / "data")
    pipeline = env.get("COMFYUI_PIPELINE", "").strip().lower() or "checkpoint"
    # FLUX.1 Dev is guidance-distilled: it wants fewer steps and its own sampler pairing.
    flux = pipeline == "flux"
    return Settings(
        deepseek_api_key=env.get("DEEPSEEK_API_KEY", "").strip(),
        deepseek_base_url=(env.get("DEEPSEEK_BASE_URL", "").strip() or "https://api.deepseek.com").rstrip("/"),
        deepseek_model=env.get("DEEPSEEK_MODEL", "").strip(),
        deepseek_timeout_s=_float("DEEPSEEK_TIMEOUT_SECONDS", 180.0),
        deepseek_max_retries=_int("DEEPSEEK_MAX_RETRIES", 1),
        chapter_words=_int("NEBIRU_CHAPTER_WORDS", 1500),
        comfyui_url=(env.get("COMFYUI_URL", "").strip() or "http://127.0.0.1:8188").rstrip("/"),
        comfyui_checkpoint=env.get("COMFYUI_CHECKPOINT", "").strip(),
        comfyui_workflow=env.get("COMFYUI_WORKFLOW", "").strip(),
        comfyui_base_size=_int("COMFYUI_BASE_SIZE", 1024),
        comfyui_steps=_int("COMFYUI_STEPS", 24 if flux else 28),
        comfyui_cfg=_float("COMFYUI_CFG", 6.5),
        comfyui_sampler=env.get("COMFYUI_SAMPLER", "").strip() or ("euler" if flux else "dpmpp_2m"),
        comfyui_scheduler=env.get("COMFYUI_SCHEDULER", "").strip() or ("simple" if flux else "karras"),
        comfyui_timeout_s=_float("COMFYUI_TIMEOUT_SECONDS", 600.0 if flux else 300.0),
        data_dir=data_dir,
        comfyui_pipeline=pipeline,
        flux_unet=env.get("FLUX_UNET_FILE", "").strip(),
        flux_clip_l=env.get("FLUX_CLIP_L_FILE", "").strip() or "clip_l.safetensors",
        flux_t5=env.get("FLUX_T5_FILE", "").strip() or "t5xxl_fp8_e4m3fn.safetensors",
        flux_vae=env.get("FLUX_VAE_FILE", "").strip() or "ae.safetensors",
        flux_guidance=_float("FLUX_GUIDANCE", 3.5),
        deepseek_vision_model=env.get("DEEPSEEK_VISION_MODEL", "").strip(),
        static_dir=_path("NEBIRU_STATIC_DIR"),
        model_status_file=_path("NEBIRU_MODEL_STATUS_FILE"),
    )
