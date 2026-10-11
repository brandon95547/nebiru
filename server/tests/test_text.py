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


def test_plan_for_a_reworded_book_keeps_the_sources_sections_under_new_titles(client: TestClient, network: Recorder) -> None:
    network.reply_with(
        completion(
            json.dumps(
                {
                    "title": "Tides and Lanterns",
                    "description": "A sea tale, retold.",
                    "chapters": {"s1": {"title": "Fog over the Quay", "summary": "The harbour at dawn."}, "zz": {"title": "unknown id"}},
                }
            )
        )
    )
    response = client.post(
        "/api/text/plan",
        json={
            "kind": "import",
            "mode": "reword",
            "sources": [
                {
                    "name": "sea.epub",
                    "title": "Sea Stories",
                    "sections": [
                        {"id": "s1", "title": "The Harbour", "wordCount": 900, "excerpt": "Fog lay on the water."},
                        {"id": "s2", "title": "Open Sea", "wordCount": 400, "excerpt": "The wind rose."},
                    ],
                }
            ],
        },
    )
    plan = response.json()
    # A new title for the new book, one chapter per section in the source's order.
    assert plan["title"] == "Tides and Lanterns"
    assert plan["chapters"] == [
        {"id": None, "title": "Fog over the Quay", "summary": "The harbour at dawn.", "sourceSectionIds": ["s1"]},
        # A section the model did not name keeps the source's heading.
        {"id": None, "title": "Open Sea", "summary": "", "sourceSectionIds": ["s2"]},
    ]
    assert "in entirely different words" in network.bodies("chat/completions")[0]["messages"][1]["content"]


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
        "note": None,
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


REWORD = {**BRIEF, "origin": {"kind": "import", "mode": "reword"}}


def rewording(network: Recorder, pictures: httpx.Response | None = None) -> None:
    """A fake model that 'rewords' a passage by upper-casing it, so the test can see what went where."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        prompt = body["messages"][-1]["content"]
        if "response_format" in body:
            return pictures or completion(json.dumps({"prompts": ["A lighthouse in fog."]}))
        passage = prompt.split("PASSAGE:\n", 1)[1].split("\n\nRewrite the passage.", 1)[0]
        return completion(passage.upper())

    network.handler = handler


def test_rewording_a_chapter_goes_passage_by_passage_and_keeps_order_and_layout(client: TestClient, network: Recorder) -> None:
    rewording(network)
    long = " ".join(["word"] * 500)
    source = [f"one {long}", "## A heading", f"two {long}", "1. first entry", "2. second entry", "a line of verse\nand another", f"three {long}"]
    draft = client.post("/api/text/chapter", json={"brief": REWORD, "chapterIndex": 0, "sourceParagraphs": source}).json()

    assert draft["paragraphs"] == [p.upper() for p in source]
    assert draft["illustrationPrompts"] == ["A lighthouse in fog."]
    assert draft["note"] is None
    passages = [b for b in network.bodies("chat/completions") if "response_format" not in b]
    # 1,500+ words of source is more than one passage; nothing is dropped between them.
    assert len(passages) == 2
    assert all("Carry over none of its wording" in p["messages"][1]["content"] for p in passages)
    # A passage never ends on a heading: the heading stays with the text it heads.
    assert "## A heading\n\ntwo word" in passages[0]["messages"][1]["content"]
    assert "1. first entry\n\n2. second entry\n\na line of verse\nand another" in passages[1]["messages"][1]["content"]


def test_a_reworded_passage_gains_no_heading_of_its_own(client: TestClient, network: Recorder) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "response_format" in json.loads(request.content):
            return completion(json.dumps({"prompts": ["A seed tray."]}))
        return completion("## Sowing by the Calendar\n\nBegin with the tough kinds.")

    network.handler = handler
    draft = client.post("/api/text/chapter", json={"brief": REWORD, "chapterIndex": 0, "sourceParagraphs": ["Sow hardy crops first."]}).json()
    assert draft["paragraphs"] == ["Begin with the tough kinds."]


def test_a_reworded_chapter_survives_losing_its_illustration_ideas(client: TestClient, network: Recorder) -> None:
    rewording(network, pictures=httpx.Response(402, json={"error": {"message": "Insufficient Balance"}}))
    draft = client.post("/api/text/chapter", json={"brief": REWORD, "chapterIndex": 0, "sourceParagraphs": ["Some text."]}).json()
    assert draft["paragraphs"] == ["SOME TEXT."]
    assert draft["illustrationPrompts"] == []
    assert draft["note"] == "No illustrations were planned: The DeepSeek account has no balance left (HTTP 402)."


def test_regenerating_a_reworded_chapter_with_a_direction_writes_from_the_source(client: TestClient, network: Recorder) -> None:
    network.reply_with(completion("New prose.\n\n===ILLUSTRATIONS===\nA scene."))
    client.post(
        "/api/text/chapter",
        json={"brief": REWORD, "chapterIndex": 0, "sourceParagraphs": ["Source one.", "Source two."], "instruction": "Open with the storm"},
    )
    prompt = network.bodies("chat/completions")[0]["messages"][1]["content"]
    assert "SOURCE MATERIAL:\nSource one.\n\nSource two." in prompt
    assert "do not reuse the source's sentences" in prompt
    assert "Open with the storm" in prompt


def test_chunk_paragraphs_keeps_headings_with_their_text() -> None:
    from app.text_service import chunk_paragraphs

    hundred = " ".join(["w"] * 100)
    assert chunk_paragraphs([], 200) == []
    assert chunk_paragraphs(["short"], 200) == [["short"]]
    assert chunk_paragraphs([hundred, hundred, hundred], 200) == [[hundred, hundred], [hundred]]
    # A chunk never ends on a heading, and a trailing heading joins the passage before it.
    assert chunk_paragraphs([hundred, hundred, "## Next", hundred], 200) == [[hundred, hundred], ["## Next", hundred]]
    assert chunk_paragraphs([hundred, "## Mid", hundred, hundred], 200) == [[hundred, "## Mid", hundred], [hundred]]
    assert chunk_paragraphs([hundred, hundred, "## Dangling"], 200) == [[hundred, hundred, "## Dangling"]]


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
