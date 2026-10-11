from __future__ import annotations

import json

import httpx
from fastapi.testclient import TestClient

from app.text_service import parse_chapter, split_paragraphs

from .conftest import BRIEF, Recorder, completion


def test_plan_from_concept(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion(
            json.dumps(
                {
                    "title": "Backyard Universe",
                    "description": "Twelve months under the stars.",
                    "chapters": [
                        {"title": "First Light", "summary": "Unboxing the telescope."},
                        {"title": "", "summary": "dropped: no title"},
                        "dropped: not an object",
                    ],
                }
            )
        )
    )
    response = client.post("/api/text/plan", json={"kind": "concept", "concept": "A stargazing guide", "chapterCount": 8})
    assert response.status_code == 200
    assert response.json() == {
        "title": "Backyard Universe",
        "description": "Twelve months under the stars.",
        "chapters": [{"id": None, "title": "First Light", "summary": "Unboxing the telescope.", "sourceSectionIds": []}],
    }
    sent = network.bodies("chat/completions")[0]
    assert sent["model"] == "test-model"
    assert sent["response_format"] == {"type": "json_object"}
    assert sent["thinking"] == {"type": "disabled"}
    assert "about 8" in sent["messages"][1]["content"]
    assert network.requests[0].headers["authorization"] == "Bearer test-key"


def test_plan_preserved_keeps_the_sources_own_sections(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion(json.dumps({"title": "Ignored", "description": "A sea tale.", "summaries": {"s1": "Fog.", "zz": "unknown id"}}))
    )
    response = client.post(
        "/api/text/plan",
        json={
            "kind": "import",
            "mode": "preserve",
            "sources": [
                {
                    "name": "sea.epub",
                    "title": "Sea Stories",
                    "sections": [
                        {"id": "s1", "title": "The Harbour", "wordCount": 900, "excerpt": "Fog lay on the water."},
                        {"id": "s2", "title": None, "wordCount": 400, "excerpt": "Later that night."},
                    ],
                }
            ],
        },
    )
    plan = response.json()
    assert plan["title"] == "Sea Stories"
    assert plan["description"] == "A sea tale."
    assert plan["chapters"] == [
        {"id": None, "title": "The Harbour", "summary": "Fog.", "sourceSectionIds": ["s1"]},
        {"id": None, "title": "Chapter 2", "summary": "", "sourceSectionIds": ["s2"]},
    ]


def test_plan_adaptation_drops_section_ids_the_source_does_not_have(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion(json.dumps({"title": "New", "description": "d", "chapters": [{"title": "One", "summary": "s", "sourceSectionIds": ["s1", "made-up"]}]}))
    )
    response = client.post(
        "/api/text/plan",
        json={"kind": "import", "mode": "adapt", "sources": [{"name": "a.txt", "sections": [{"id": "s1", "title": "A", "wordCount": 10, "excerpt": "x"}]}]},
    )
    assert response.json()["chapters"][0]["sourceSectionIds"] == ["s1"]


def test_truncated_json_is_retried_with_a_larger_budget(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion('{"title": "Cut', finish="length"),
        completion(json.dumps({"title": "Whole", "description": "d", "chapters": [{"title": "One", "summary": "s"}]})),
    )
    response = client.post("/api/text/plan", json={"kind": "concept", "concept": "x", "chapterCount": 5})
    assert response.json()["title"] == "Whole"
    first, second = network.bodies("chat/completions")
    assert second["max_tokens"] == first["max_tokens"] * 2


def test_write_chapter_splits_prose_from_illustration_prompts(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion(
            "First Light\n\nThe box was heavier than she expected.\nIt took both of them to lift it.\n\n"
            "**By dusk** the tripod stood on the lawn.\n\n===ILLUSTRATIONS===\n"
            "- A girl and her grandmother lifting a long box on a porch at dusk.\n2. A telescope on a lawn under the first stars.\n"
        )
    )
    response = client.post("/api/text/chapter", json={"brief": BRIEF, "chapterIndex": 0, "sourceParagraphs": []})
    assert response.json() == {
        "paragraphs": [
            "The box was heavier than she expected. It took both of them to lift it.",
            "By dusk the tripod stood on the lawn.",
        ],
        "illustrationPrompts": [
            "A girl and her grandmother lifting a long box on a porch at dusk.",
            "A telescope on a lawn under the first stars.",
        ],
    }
    prompt = network.bodies("chat/completions")[0]["messages"][1]["content"]
    assert "<- this chapter" in prompt and "about 1200 words" in prompt


def test_a_chapter_cut_off_by_the_length_limit_is_continued(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion("The night was clear and the sky was", finish="length"),
        completion(" full of stars.\n\n===ILLUSTRATIONS===\nA field under stars."),
    )
    response = client.post("/api/text/chapter", json={"brief": BRIEF, "chapterIndex": 1, "sourceParagraphs": []})
    assert response.json()["paragraphs"] == ["The night was clear and the sky was full of stars."]
    follow_up = network.bodies("chat/completions")[1]["messages"]
    assert follow_up[-2] == {"role": "assistant", "content": "The night was clear and the sky was"}
    assert "Continue from exactly where it stopped" in follow_up[-1]["content"]


def test_adaptation_sends_the_source_material(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("New prose.\n\n===ILLUSTRATIONS===\nA scene."))
    brief = {**BRIEF, "origin": {"kind": "import", "mode": "adapt"}}
    client.post(
        "/api/text/chapter",
        json={"brief": brief, "chapterIndex": 0, "sourceParagraphs": ["Source one.", "Source two."], "instruction": "Open with the storm"},
    )
    prompt = network.bodies("chat/completions")[0]["messages"][1]["content"]
    assert "SOURCE MATERIAL:\nSource one.\n\nSource two." in prompt
    assert "Open with the storm" in prompt


def test_chapter_index_outside_the_outline_is_a_bad_request(client: TestClient) -> None:
    response = client.post("/api/text/chapter", json={"brief": BRIEF, "chapterIndex": 9, "sourceParagraphs": []})
    assert response.status_code == 400


def test_revise_returns_only_the_passage(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("```\nThe sky was clear.\n```"))
    response = client.post("/api/text/revise", json={"brief": BRIEF, "text": "the sky were clear", "action": "grammar"})
    assert response.json() == {"text": "The sky was clear.", "note": None}
    sent = network.bodies("chat/completions")[0]
    assert sent["temperature"] == 0.1
    assert "Correct the grammar" in sent["messages"][1]["content"]


def test_shorten_and_expand_give_the_model_a_word_target(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("Short."), completion("Long."))
    passage = " ".join(["word"] * 40)
    client.post("/api/text/revise", json={"brief": BRIEF, "text": passage, "action": "shorten"})
    client.post("/api/text/revise", json={"brief": BRIEF, "text": passage, "action": "expand"})
    shorten, expand = (body["messages"][1]["content"] for body in network.bodies("chat/completions"))
    assert "is 40 words. Cut it to about 20 words" in shorten
    assert "is 40 words. Expand it to about 80 words" in expand


def test_revise_style_names_the_style(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("Lo, the heavens were clear."))
    client.post("/api/text/revise", json={"brief": BRIEF, "text": "The sky was clear.", "action": "style", "style": "Poetic"})
    assert "in this style: Poetic" in network.bodies("chat/completions")[0]["messages"][1]["content"]


def test_outline_revision_keeps_known_ids_and_clears_invented_ones(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion(
            json.dumps(
                {
                    "reply": "Added a chapter on planets.",
                    "chapters": [
                        {"id": "ch_1", "title": "First Light", "summary": "s"},
                        {"id": "ch_99", "title": "The Planets", "summary": "new"},
                    ],
                }
            )
        )
    )
    body = client.post("/api/text/outline", json={"brief": BRIEF, "instruction": "add planets"}).json()
    assert body["reply"] == "Added a chapter on planets."
    assert [(c["id"], c["title"]) for c in body["chapters"]] == [("ch_1", "First Light"), (None, "The Planets")]


def test_outline_question_changes_nothing(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion(json.dumps({"reply": "Two chapters so far.", "chapters": None})))
    body = client.post("/api/text/outline", json={"brief": BRIEF, "instruction": "how many chapters?"}).json()
    assert body == {"chapters": None, "reply": "Two chapters so far."}


def test_chat_answers_a_question(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("It opens slowly; consider starting with the box."))
    body = client.post(
        "/api/text/chat",
        json={"brief": BRIEF, "messages": [{"role": "user", "text": "How is the pacing?"}], "chapterTitle": "First Light", "chapterText": "The box was heavy."},
    ).json()
    assert body == {"reply": "It opens slowly; consider starting with the box.", "revisedChapter": None}
    sent = network.bodies("chat/completions")[0]["messages"]
    assert "THE CHAPTER THE AUTHOR HAS OPEN: “First Light”" in sent[0]["content"]
    assert sent[-1] == {"role": "user", "content": "How is the pacing?"}


def test_chat_returns_a_revised_chapter_when_asked_for_a_change(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("I renamed the dog to Juno.\n\n=== REVISED CHAPTER ===\n\nFirst Light\n\nJuno barked.\n\nThe box was heavy."))
    body = client.post(
        "/api/text/chat",
        json={"brief": BRIEF, "messages": [{"role": "user", "text": "Rename the dog Juno"}], "chapterTitle": "First Light", "chapterText": "Rex barked.\n\nThe box was heavy."},
    ).json()
    assert body == {"reply": "I renamed the dog to Juno.", "revisedChapter": ["Juno barked.", "The box was heavy."]}


def test_chat_without_an_open_chapter_cannot_edit(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("Click into a chapter first."))
    client.post("/api/text/chat", json={"brief": BRIEF, "messages": [{"role": "user", "text": "fix it"}]})
    assert "has no chapter open" in network.bodies("chat/completions")[0]["messages"][0]["content"]


def test_an_empty_account_is_reported_not_papered_over(client: TestClient, network: Recorder) -> None:
    network.reply_with(httpx.Response(402, json={"error": {"message": "Insufficient Balance"}}))
    response = client.post("/api/text/revise", json={"brief": BRIEF, "text": "some text", "action": "rewrite"})
    assert response.status_code == 502
    assert response.json() == {"detail": "The DeepSeek account has no balance left (HTTP 402)."}


def test_an_empty_reply_is_an_error(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("   "))
    response = client.post("/api/text/revise", json={"brief": BRIEF, "text": "some text", "action": "rewrite"})
    assert response.status_code == 502
    assert response.json()["detail"] == "DeepSeek returned an empty response."


def test_a_model_that_rejects_the_thinking_parameter_is_asked_again_without_it(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        httpx.Response(400, json={"error": {"message": "unknown parameter: thinking"}}),
        completion("Fine."),
    )
    response = client.post("/api/text/revise", json={"brief": BRIEF, "text": "some text", "action": "rewrite"})
    assert response.json()["text"] == "Fine."
    first, second = network.bodies("chat/completions")
    assert "thinking" in first and "thinking" not in second


def test_missing_key_is_reported_as_not_configured(make_client, network: Recorder) -> None:
    client = make_client(deepseek_api_key="")
    response = client.post("/api/text/revise", json={"brief": BRIEF, "text": "some text", "action": "rewrite"})
    assert response.status_code == 503
    assert "DEEPSEEK_API_KEY" in response.json()["detail"]
    assert network.requests == []


def test_parse_chapter_tolerates_a_decorated_marker_and_a_repeated_title() -> None:
    draft = parse_chapter("Chapter 2: The Moon\n\nIt rose late.\n\n**ILLUSTRATIONS**\n\n* A late moon over rooftops.", "The Moon")
    assert draft.paragraphs == ["It rose late."]
    assert draft.illustration_prompts == ["A late moon over rooftops."]


def test_parse_chapter_without_a_marker_is_all_prose() -> None:
    draft = parse_chapter("One.\n\nTwo.", "Title")
    assert draft.paragraphs == ["One.", "Two."]
    assert draft.illustration_prompts == []


def test_split_paragraphs_strips_markdown() -> None:
    assert split_paragraphs("## A heading\n\nSome **bold** text\nwrapped.\n\n\n\nLast.") == ["A heading", "Some bold text wrapped.", "Last."]
