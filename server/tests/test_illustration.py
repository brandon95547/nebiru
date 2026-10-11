from __future__ import annotations

import json
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.comfy import dimensions, fill_workflow
from app.styles import build_prompts

from .conftest import COMFY, Recorder

PNG = b"\x89PNG\r\n\x1a\n fake image bytes"
REQUEST = {"prompt": "A lighthouse at dusk.", "styleId": "ink", "aspect": 0.8, "purpose": "interior", "seed": 42}


def comfy(history: dict | None = None, checkpoints: list[str] | None = None, queue_status: int = 200):
    """A fake ComfyUI that finishes a job on the second history poll."""
    polls = {"count": 0}
    names = ["sdxl_base.safetensors", "other.safetensors"] if checkpoints is None else checkpoints

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/system_stats":
            return httpx.Response(200, json={"system": {}})
        if path == "/object_info/CheckpointLoaderSimple":
            return httpx.Response(200, json={"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [names, {}]}}}})
        if path == "/prompt":
            if queue_status != 200:
                return httpx.Response(queue_status, json={"error": {"message": "Prompt outputs failed validation"}})
            return httpx.Response(200, json={"prompt_id": "job-1"})
        if path == "/history/job-1":
            polls["count"] += 1
            if polls["count"] < 2:
                return httpx.Response(200, json={})
            done = history or {
                "status": {"status_str": "success", "completed": True},
                "outputs": {"7": {"images": [{"filename": "nebiru_0001.png", "subfolder": "", "type": "output"}]}},
            }
            return httpx.Response(200, json={"job-1": done})
        if path == "/view":
            return httpx.Response(200, content=PNG)
        return httpx.Response(404)

    return handler


def test_generate_runs_the_workflow_and_stores_the_image(client: TestClient, network: Recorder, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.comfy.POLL_INTERVAL_S", 0)
    network.handler = comfy()
    response = client.post("/api/illustrations", json=REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["seed"] == 42 and body["src"].startswith("/api/images/") and body["src"].endswith(".png")

    stored = tmp_path / "data" / "images" / body["src"].rsplit("/", 1)[1]
    assert stored.read_bytes() == PNG
    assert client.get(body["src"]).content == PNG

    workflow = network.bodies("/prompt")[0]["prompt"]
    assert workflow["1"]["inputs"]["ckpt_name"] == "sdxl_base.safetensors"
    assert workflow["2"]["inputs"]["text"].startswith("A lighthouse at dusk, pen and ink illustration")
    assert "lettering" in workflow["3"]["inputs"]["text"]
    assert (workflow["4"]["inputs"]["width"], workflow["4"]["inputs"]["height"]) == (896, 1152)
    assert workflow["5"]["inputs"]["seed"] == 42 and workflow["5"]["inputs"]["steps"] == 20

    view = next(r for r in network.requests if r.url.path == "/view")
    assert view.url.params["filename"] == "nebiru_0001.png"


def test_a_configured_checkpoint_is_used_without_asking_comfy(make_client, network: Recorder, monkeypatch) -> None:
    monkeypatch.setattr("app.comfy.POLL_INTERVAL_S", 0)
    network.handler = comfy()
    client = make_client(comfyui_checkpoint="mine.safetensors")
    client.post("/api/illustrations", json=REQUEST)
    assert network.bodies("/prompt")[0]["prompt"]["1"]["inputs"]["ckpt_name"] == "mine.safetensors"
    assert not any("object_info" in r.url.path for r in network.requests)


def test_a_seed_is_chosen_when_none_is_given(client: TestClient, network: Recorder, monkeypatch) -> None:
    monkeypatch.setattr("app.comfy.POLL_INTERVAL_S", 0)
    network.handler = comfy()
    body = client.post("/api/illustrations", json={**REQUEST, "seed": None}).json()
    assert isinstance(body["seed"], int)
    assert network.bodies("/prompt")[0]["prompt"]["5"]["inputs"]["seed"] == body["seed"]


def test_a_failed_job_reports_comfys_own_error(client: TestClient, network: Recorder, monkeypatch) -> None:
    monkeypatch.setattr("app.comfy.POLL_INTERVAL_S", 0)
    network.handler = comfy(
        history={
            "status": {
                "status_str": "error",
                "messages": [["execution_error", {"node_type": "KSampler", "exception_message": "out of memory"}]],
            },
            "outputs": {},
        }
    )
    response = client.post("/api/illustrations", json=REQUEST)
    assert response.status_code == 502
    assert response.json() == {"detail": "ComfyUI failed in KSampler: out of memory"}


def test_a_rejected_workflow_reports_why(client: TestClient, network: Recorder) -> None:
    network.handler = comfy(queue_status=400)
    response = client.post("/api/illustrations", json=REQUEST)
    assert response.status_code == 502
    assert response.json() == {"detail": "ComfyUI rejected the workflow: Prompt outputs failed validation"}


def test_unreachable_comfy_is_not_configured(client: TestClient, network: Recorder) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    network.handler = refuse
    response = client.post("/api/illustrations", json=REQUEST)
    assert response.status_code == 503
    assert response.json() == {"detail": f"ComfyUI is not reachable at {COMFY}."}


def test_a_custom_workflow_file_has_its_tokens_filled(make_client, network: Recorder, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.comfy.POLL_INTERVAL_S", 0)
    network.handler = comfy()
    workflow = tmp_path / "flux.json"
    workflow.write_text(
        json.dumps(
            {
                "10": {"class_type": "Text", "inputs": {"text": "masterpiece, %prompt%"}},
                "11": {"class_type": "Sampler", "inputs": {"seed": "%seed%", "size": ["%width%", "%height%"], "link": ["10", 0]}},
            }
        )
    )
    client = make_client(comfyui_workflow=str(workflow))
    assert client.post("/api/illustrations", json=REQUEST).status_code == 200
    sent = network.bodies("/prompt")[0]["prompt"]
    assert sent["10"]["inputs"]["text"].startswith("masterpiece, A lighthouse at dusk, pen and ink")
    assert sent["11"]["inputs"] == {"seed": 42, "size": [896, 1152], "link": ["10", 0]}
    assert not any("object_info" in r.url.path for r in network.requests)


def test_status_reports_each_service(make_client, network: Recorder) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user/balance":
            return httpx.Response(200, json={"is_available": True, "balance_infos": []})
        return comfy(checkpoints=[])(request)

    network.handler = handler
    assert make_client().get("/api/status").json() == {
        "text": {"available": True, "detail": ""},
        "illustration": {"available": False, "detail": "ComfyUI has no checkpoint models installed."},
    }


def test_status_warns_about_an_empty_account_but_keeps_the_service_live(client: TestClient, network: Recorder) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user/balance":
            return httpx.Response(200, json={"is_available": False})
        return comfy()(request)

    network.handler = handler
    assert client.get("/api/status").json() == {
        "text": {"available": True, "detail": "The DeepSeek account has no balance left."},
        "illustration": {"available": True, "detail": ""},
    }


def test_status_without_a_key_or_comfy(make_client, network: Recorder) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    network.handler = refuse
    status = make_client(deepseek_api_key="").get("/api/status").json()
    assert status["text"] == {"available": False, "detail": "DEEPSEEK_API_KEY is not set."}
    assert status["illustration"] == {"available": False, "detail": f"ComfyUI is not reachable at {COMFY}."}


def test_dimensions_keep_the_pixel_budget_and_snap_to_the_grid() -> None:
    assert dimensions(1.0, 1024) == (1024, 1024)
    assert dimensions(0.8, 1024) == (896, 1152)
    assert dimensions(1.5, 1024) == (1280, 832)
    assert dimensions(2 / 3, 512) == (448, 640)


def test_fill_workflow_only_turns_whole_numeric_tokens_into_numbers() -> None:
    values = {"%seed%": 7, "%width%": 512, "%height%": 512, "%steps%": 20, "%cfg%": 6.5,
              "%prompt%": "a cat", "%negative%": "blurry", "%checkpoint%": "m", "%sampler%": "euler", "%scheduler%": "normal"}
    assert fill_workflow({"a": "%seed%", "b": "seed %seed%", "c": ["%cfg%", "%prompt% !"], "d": 3}, values) == {
        "a": 7,
        "b": "seed %seed%",
        "c": [6.5, "a cat !"],
        "d": 3,
    }


def test_cover_prompts_ask_for_a_cover_composition() -> None:
    positive, negative = build_prompts("  A ship in a storm.  ", "classical", "cover")
    assert positive.startswith("A ship in a storm, classical oil painting")
    assert positive.endswith("calm uncluttered area near the top")
    assert negative.startswith("text, lettering")
    assert build_prompts("x", "no-such-style", "interior")[0].startswith("x, watercolor")


def test_pictures_for_dark_pages_are_drawn_on_a_dark_ground(client: TestClient, network: Recorder, monkeypatch) -> None:
    monkeypatch.setattr("app.comfy.POLL_INTERVAL_S", 0)
    network.handler = comfy()
    client.post("/api/illustrations", json={**REQUEST, "theme": "dark"})
    client.post("/api/illustrations", json=REQUEST)
    dark, light = (body["prompt"]["2"]["inputs"]["text"] for body in network.bodies("/prompt"))
    assert "deep black background" in dark
    assert "black background" not in light
