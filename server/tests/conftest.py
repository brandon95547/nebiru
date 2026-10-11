from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

DEEPSEEK = "https://deepseek.test"
COMFY = "http://comfy.test"


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    values: dict[str, Any] = dict(
        deepseek_api_key="test-key",
        deepseek_base_url=DEEPSEEK,
        deepseek_model="test-model",
        deepseek_timeout_s=5.0,
        deepseek_max_retries=0,
        chapter_words=1200,
        comfyui_url=COMFY,
        comfyui_checkpoint="",
        comfyui_workflow="",
        comfyui_base_size=1024,
        comfyui_steps=20,
        comfyui_cfg=7.0,
        comfyui_sampler="euler",
        comfyui_scheduler="normal",
        comfyui_timeout_s=5.0,
        data_dir=tmp_path / "data",
    )
    values.update(overrides)
    return Settings(**values)


def completion(content: str, finish: str = "stop") -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": finish}]})


class Recorder:
    """A fake network: routes requests to a handler and remembers what was sent."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.handler: Callable[[httpx.Request], httpx.Response] = lambda _: httpx.Response(404)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def bodies(self, path_part: str) -> list[dict[str, Any]]:
        return [json.loads(r.content) for r in self.requests if path_part in r.url.path and r.content]

    def reply_with(self, *responses: httpx.Response) -> None:
        """Answer chat completions with these responses in order; everything else 404s."""
        queue = list(responses)

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/chat/completions"):
                return queue.pop(0)
            return httpx.Response(404)

        self.handler = handler


@pytest.fixture
def network() -> Recorder:
    return Recorder()


@pytest.fixture
def make_client(tmp_path: Path, network: Recorder) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def build(**overrides: Any) -> TestClient:
        app = create_app(make_settings(tmp_path, **overrides), transport=httpx.MockTransport(network))
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


BRIEF = {
    "title": "Night Sky",
    "author": "A. Writer",
    "description": "A year of stargazing.",
    "origin": {"kind": "concept", "concept": "A stargazing guide."},
    "chapters": [
        {"id": "ch_1", "title": "First Light", "summary": "Setting up the telescope."},
        {"id": "ch_2", "title": "The Moon", "summary": "A month of phases."},
    ],
}
