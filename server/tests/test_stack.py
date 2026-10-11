"""The pieces that make Nebiru a self-contained install: the FLUX pipeline,
server-side book storage, serving the web app, and download progress."""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.downloads import download_message

from .conftest import Recorder

PNG = b"\x89PNG\r\n\x1a\n fake image bytes"
REQUEST = {"prompt": "A lighthouse at dusk.", "styleId": "ink", "aspect": 0.8, "purpose": "interior", "seed": 7}
FLUX = dict(comfyui_pipeline="flux", flux_unet="flux1-dev-Q5_K_S.gguf", comfyui_steps=24, comfyui_sampler="euler", comfyui_scheduler="simple")


def flux_comfy(unets=("flux1-dev-Q5_K_S.gguf",), encoders=("t5xxl_fp8_e4m3fn.safetensors", "clip_l.safetensors"), vaes=("ae.safetensors",), gguf_node=True):
    """A fake ComfyUI holding the given model files."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/system_stats":
            return httpx.Response(200, json={})
        if path == "/object_info/UnetLoaderGGUF":
            info = {"UnetLoaderGGUF": {"input": {"required": {"unet_name": [list(unets), {}]}}}} if gguf_node else {}
            return httpx.Response(200, json=info)
        if path == "/object_info/DualCLIPLoader":
            # The newer way ComfyUI describes a choice.
            return httpx.Response(200, json={"DualCLIPLoader": {"input": {"required": {"clip_name1": ["COMBO", {"options": list(encoders)}]}}}})
        if path == "/object_info/VAELoader":
            return httpx.Response(200, json={"VAELoader": {"input": {"required": {"vae_name": [list(vaes), {}]}}}})
        if path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "job"})
        if path == "/history/job":
            return httpx.Response(200, json={"job": {"status": {"status_str": "success", "completed": True}, "outputs": {"10": {"images": [{"filename": "n.png", "subfolder": "", "type": "output"}]}}}})
        if path == "/view":
            return httpx.Response(200, content=PNG)
        return httpx.Response(404)

    return handler


# --- FLUX pipeline ------------------------------------------------------------


def test_flux_pipeline_builds_the_gguf_workflow(make_client, network: Recorder, monkeypatch) -> None:
    monkeypatch.setattr("app.comfy.POLL_INTERVAL_S", 0)
    network.handler = flux_comfy()
    response = make_client(**FLUX).post("/api/illustrations", json=REQUEST)
    assert response.status_code == 200

    graph = network.bodies("/prompt")[0]["prompt"]
    kinds = {node["class_type"] for node in graph.values()}
    assert kinds == {"UnetLoaderGGUF", "DualCLIPLoader", "VAELoader", "CLIPTextEncode", "FluxGuidance", "EmptySD3LatentImage", "KSampler", "VAEDecode", "SaveImage"}
    assert graph["1"]["inputs"] == {"unet_name": "flux1-dev-Q5_K_S.gguf"}
    assert graph["2"]["inputs"] == {"clip_name1": "t5xxl_fp8_e4m3fn.safetensors", "clip_name2": "clip_l.safetensors", "type": "flux"}
    assert graph["3"]["inputs"] == {"vae_name": "ae.safetensors"}
    assert graph["4"]["inputs"]["text"].startswith("A lighthouse at dusk, pen and ink illustration")
    assert graph["5"]["inputs"] == {"conditioning": ["4", 0], "guidance": 3.5}
    # Dev is guidance-distilled: no negative prompt, cfg fixed at 1.
    assert graph["6"]["inputs"]["text"] == ""
    sampler = graph["8"]["inputs"]
    assert (sampler["cfg"], sampler["steps"], sampler["sampler_name"], sampler["scheduler"], sampler["seed"]) == (1.0, 24, "euler", "simple", 7)
    assert (graph["7"]["inputs"]["width"], graph["7"]["inputs"]["height"]) == (896, 1152)
    # Every link points at a node that exists.
    for node in graph.values():
        for value in node["inputs"].values():
            if isinstance(value, list):
                assert value[0] in graph


def test_flux_is_ready_when_comfy_has_every_file(make_client, network: Recorder) -> None:
    network.handler = flux_comfy()
    assert make_client(**FLUX).get("/api/status").json()["illustration"] == {"available": True, "detail": ""}


def test_flux_status_names_the_files_still_missing(make_client, network: Recorder) -> None:
    network.handler = flux_comfy(unets=(), encoders=("clip_l.safetensors",))
    state = make_client(**FLUX).get("/api/status").json()["illustration"]
    assert state == {"available": False, "detail": "ComfyUI does not have flux1-dev-Q5_K_S.gguf, t5xxl_fp8_e4m3fn.safetensors yet."}


def test_flux_status_notices_a_missing_gguf_loader(make_client, network: Recorder) -> None:
    network.handler = flux_comfy(gguf_node=False)
    detail = make_client(**FLUX).get("/api/status").json()["illustration"]["detail"]
    assert detail == "ComfyUI is missing the GGUF loader (the ComfyUI-GGUF custom node)."


def test_status_reports_download_progress_while_comfy_is_still_starting(make_client, network: Recorder, tmp_path: Path) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    network.handler = refuse
    progress = tmp_path / "download.json"
    progress.write_text(json.dumps({"state": "downloading", "doneBytes": 6.0e9, "totalBytes": 13.8e9, "updatedAt": time.time()}))
    state = make_client(**FLUX, model_status_file=progress).get("/api/status").json()["illustration"]
    assert state == {"available": False, "detail": "Downloading the illustration model, first start only: 43% (6.0 of 13.8 GB)."}


def test_download_message_covers_each_state(tmp_path: Path) -> None:
    file = tmp_path / "download.json"
    assert download_message(None) is None
    assert download_message(file) is None  # no file yet

    file.write_text(json.dumps({"state": "ready", "updatedAt": time.time()}))
    assert download_message(file) is None

    file.write_text(json.dumps({"state": "error", "message": "clip_l.safetensors: not found", "updatedAt": time.time()}))
    assert download_message(file) == "The illustration model could not be downloaded: clip_l.safetensors: not found"

    file.write_text(json.dumps({"state": "downloading", "doneBytes": 1, "totalBytes": 10, "updatedAt": time.time() - 600}))
    assert "stalled" in download_message(file)

    file.write_text("not json")
    assert download_message(file) is None


# --- books --------------------------------------------------------------------


def test_books_are_saved_listed_and_deleted(client: TestClient, tmp_path: Path) -> None:
    book = {"id": "book_abc123", "title": "Night Sky", "chapters": [{"id": "ch_1", "title": "Ünïcode ✓"}]}
    assert client.get("/api/books").json() == {"books": []}
    assert client.put("/api/books/book_abc123", json=book).status_code == 200
    assert client.get("/api/books").json() == {"books": [book]}
    assert json.loads((tmp_path / "data" / "books" / "book_abc123.json").read_text(encoding="utf-8")) == book

    updated = {**book, "title": "Night Sky, revised"}
    client.put("/api/books/book_abc123", json=updated)
    assert client.get("/api/books").json() == {"books": [updated]}
    assert [p.name for p in (tmp_path / "data" / "books").iterdir()] == ["book_abc123.json"]  # no leftovers

    assert client.delete("/api/books/book_abc123").status_code == 200
    assert client.delete("/api/books/book_abc123").status_code == 200  # deleting twice is fine
    assert client.get("/api/books").json() == {"books": []}


def test_book_ids_cannot_escape_the_books_folder(client: TestClient) -> None:
    for bad in ["..%2Fsecrets", "a.b", "x" * 65]:
        response = client.put(f"/api/books/{bad}", json={"id": bad})
        assert response.status_code in (400, 404), bad
    assert client.put("/api/books/book_1", json={"id": "book_2"}).status_code == 400


def test_a_damaged_book_file_does_not_hide_the_others(client: TestClient, tmp_path: Path) -> None:
    client.put("/api/books/good", json={"id": "good", "title": "Fine"})
    (tmp_path / "data" / "books" / "broken.json").write_text("{ not json")
    assert client.get("/api/books").json() == {"books": [{"id": "good", "title": "Fine"}]}


# --- serving the web app ------------------------------------------------------


def test_the_server_serves_the_web_app_and_its_page_addresses(make_client, tmp_path: Path) -> None:
    web = tmp_path / "dist"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>Nebiru</title>")
    (web / "assets" / "app.js").write_text("console.log('app')")
    client = make_client(static_dir=web)

    assert "Nebiru" in client.get("/").text
    assert client.get("/assets/app.js").text == "console.log('app')"
    # Pages the app routes itself come back as the app, so a reload works anywhere.
    assert "Nebiru" in client.get("/book/book_abc/plan").text
    # The API is never shadowed by the app, and unknown API addresses stay errors.
    assert client.get("/api/health").json() == {"ok": True}
    assert client.get("/api/no-such-thing").status_code == 404


def test_without_a_built_app_only_the_api_is_served(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 200
    assert client.get("/").status_code == 404
