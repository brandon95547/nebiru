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

    @property
    def images_dir(self) -> Path:
        return self.data_dir / "images"

    @property
    def text_problem(self) -> str | None:
        """Why the writing service cannot run, or None when it is configured."""
        if not self.deepseek_api_key:
            return "DEEPSEEK_API_KEY is not set in server/.env."
        if not self.deepseek_model:
            return "DEEPSEEK_MODEL is not set in server/.env."
        return None


def load_settings() -> Settings:
    load_dotenv(SERVER_DIR / ".env")
    env = os.environ
    data_dir = Path(env.get("NEBIRU_DATA_DIR", "").strip() or SERVER_DIR / "data")
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
        comfyui_steps=_int("COMFYUI_STEPS", 28),
        comfyui_cfg=_float("COMFYUI_CFG", 6.5),
        comfyui_sampler=env.get("COMFYUI_SAMPLER", "").strip() or "dpmpp_2m",
        comfyui_scheduler=env.get("COMFYUI_SCHEDULER", "").strip() or "karras",
        comfyui_timeout_s=_float("COMFYUI_TIMEOUT_SECONDS", 300.0),
        data_dir=data_dir,
    )
