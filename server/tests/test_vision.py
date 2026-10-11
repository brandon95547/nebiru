from __future__ import annotations

import base64
import io

import httpx
from fastapi.testclient import TestClient
from PIL import Image

from app.vision import parse_transcript, prepare_image

from .conftest import BRIEF, Recorder, completion


def picture(size=(3000, 1500), mode="RGB", fmt="PNG") -> bytes:
    out = io.BytesIO()
    Image.new(mode, size, "white").save(out, fmt)
    return out.getvalue()


TRANSCRIPT = """# Table of Contents

## Basic
1. Beloved Ancestors
2. Changing Luck
17. Spell for Success Under Fire

## WLS
- **Prosperity** blessing

O mighty Ancestors,
Guardians and Guides,
I do invoke you.

A second paragraph."""


def test_parse_transcript_keeps_structure_as_markup() -> None:
    title, paragraphs = parse_transcript(TRANSCRIPT)
    assert title == "Table of Contents"
    assert paragraphs == [
        "## Basic",
        "1. Beloved Ancestors",
        "2. Changing Luck",
        "17. Spell for Success Under Fire",
        "## WLS",
        "- Prosperity blessing",
        # Lines that matter stay on their own lines inside one paragraph.
        "O mighty Ancestors,\nGuardians and Guides,\nI do invoke you.",
        "A second paragraph.",
    ]


def test_parse_transcript_handles_fences_extra_titles_and_deep_headings() -> None:
    title, paragraphs = parse_transcript("```\n# First\n# Second\n#### Deep\nText\n```")
    assert title == "First"
    assert paragraphs == ["## Second", "### Deep", "Text"]
    assert parse_transcript("just a line") == (None, ["just a line"])


def test_an_unmarked_opening_line_is_taken_as_the_title() -> None:
    assert parse_transcript("Beloved Ancestors\n\nO mighty Ancestors,\nGuardians and Guides.") == (
        "Beloved Ancestors",
        ["O mighty Ancestors,\nGuardians and Guides."],
    )
    # Not a title: a sentence, a list entry, a section heading, or a first line of verse.
    for opening in ["It was a dark night.", "1. Beloved Ancestors", "## Basic", "O mighty Ancestors,\nGuardians"]:
        assert parse_transcript(f"{opening}\n\nMore text.")[0] is None, opening


def test_prepare_image_downsizes_and_flattens_to_jpeg() -> None:
    result = Image.open(io.BytesIO(prepare_image(picture(size=(3000, 1500), mode="RGBA"))))
    assert result.format == "JPEG" and result.mode == "RGB"
    assert result.size == (2000, 1000)


def test_prepare_image_turns_the_photo_upright() -> None:
    source = Image.new("RGB", (400, 200), "white")
    exif = source.getexif()
    exif[274] = 6  # the camera was held sideways
    out = io.BytesIO()
    source.save(out, "JPEG", exif=exif)
    assert Image.open(io.BytesIO(prepare_image(out.getvalue()))).size == (200, 400)


def test_import_image_sends_the_picture_and_returns_the_page(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion(TRANSCRIPT))
    response = client.post("/api/import/image", content=picture(), headers={"Content-Type": "image/png"})
    assert response.status_code == 200
    page = response.json()
    assert page["title"] == "Table of Contents"
    assert page["paragraphs"][:2] == ["## Basic", "1. Beloved Ancestors"]

    sent = network.bodies("chat/completions")[0]
    assert sent["model"] == "test-model" and sent["temperature"] == 0.0
    text, image = sent["messages"][0]["content"]
    assert text["type"] == "text" and "Transcribe its text" in text["text"]
    data = image["image_url"]["url"]
    assert data.startswith("data:image/jpeg;base64,")
    assert Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1]))).size == (2000, 1000)


def test_a_separate_vision_model_is_used_when_one_is_set(make_client, network: Recorder) -> None:
    network.reply_with(completion("Some text."), completion("Rewritten."))
    client = make_client(deepseek_vision_model="sees-images")
    client.post("/api/import/image", content=picture(size=(50, 50)))
    client.post("/api/text/revise", json={"brief": BRIEF, "text": "some text", "action": "rewrite"})
    reading, writing = network.bodies("chat/completions")
    assert reading["model"] == "sees-images"
    assert writing["model"] == "test-model"


def test_a_file_that_is_not_an_image_is_refused_before_any_model_call(client: TestClient, network: Recorder) -> None:
    response = client.post("/api/import/image", content=b"%PDF-1.4 not an image")
    assert response.status_code == 400
    assert response.json() == {"detail": "That file is not an image Nebiru can open."}
    assert network.requests == []


def test_a_page_with_no_text_is_reported(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("NO_TEXT"))
    response = client.post("/api/import/image", content=picture(size=(50, 50)))
    assert response.status_code == 422
    assert response.json() == {"detail": "No readable text was found in this image."}


def test_a_model_that_cannot_see_images_is_named_as_the_problem(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("NO_IMAGE"))
    response = client.post("/api/import/image", content=picture(size=(50, 50)))
    assert response.status_code == 502
    assert "DEEPSEEK_VISION_MODEL" in response.json()["detail"]


def test_the_authors_instruction_reaches_planning_and_illustration_prompts(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion('{"title": "T", "description": "d", "summaries": {}}'),
        completion('{"prompts": ["An emblem."]}'),
    )
    source = {"name": "toc.jpg", "title": "Table of Contents", "sections": [{"id": "s1", "title": "Table of Contents", "wordCount": 40, "excerpt": "## Basic 1. Beloved Ancestors"}]}
    wish = "A new illustrated table of contents in a dark gothic design"
    client.post("/api/text/plan", json={"kind": "import", "mode": "preserve", "instruction": wish, "sources": [source]})
    brief = {**BRIEF, "origin": {"kind": "import", "mode": "preserve", "instruction": wish}}
    client.post("/api/text/illustration-prompts", json={"brief": brief, "chapterIndex": 0, "text": "## Basic\n1. Beloved Ancestors", "count": 1})
    planning, illustrating = (body["messages"][1]["content"] for body in network.bodies("chat/completions"))
    assert wish in planning and "Let that guide the plan" in planning
    assert f"What the author asked Nebiru to make: {wish}" in illustrating
    assert "table of contents rather than a narrative" in illustrating
