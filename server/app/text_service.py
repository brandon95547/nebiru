"""The writing operations the app asks for, built on the DeepSeek client."""

from __future__ import annotations

import re
from typing import Any

from .config import Settings
from .deepseek import DeepSeek
from .errors import ServiceError
from . import prompts
from .schemas import (
    BookPlan,
    ChapterDraft,
    ChapterRequest,
    ChatRequest,
    ChatResponse,
    IllustrationPromptsRequest,
    IllustrationPromptsResponse,
    OutlineRequest,
    OutlineResponse,
    PlannedChapter,
    PlanRequest,
    ReviseRequest,
    ReviseResponse,
)

# Enough of a chapter's source to adapt from without overrunning the model's context.
SOURCE_WORD_BUDGET = 20000
CHAT_HISTORY_TURNS = 16

REVISION_TEMPERATURE = {"grammar": 0.1, "shorten": 0.4, "rewrite": 0.7, "expand": 0.7, "style": 0.8}


def _marker(marker: str) -> re.Pattern[str]:
    """Match a marker line even if the model varies its spacing or decoration."""
    words = marker.strip("=").strip()
    return re.compile(rf"^[ \t]*[=*#\-_ ]*{re.escape(words)}[=*#\-_: ]*$", re.IGNORECASE | re.MULTILINE)


ILLUSTRATIONS = _marker(prompts.ILLUSTRATION_MARKER)
REVISION = _marker(prompts.REVISION_MARKER)

FENCE = re.compile(r"^```[a-z]*\s*|\s*```$", re.IGNORECASE)
LIST_PREFIX = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")
HEADING_PREFIX = re.compile(r"^#{1,6}\s+")
EMPHASIS = re.compile(r"(\*\*|__)(.+?)\1")


def split_paragraphs(text: str) -> list[str]:
    """Model prose as clean paragraphs, with stray markdown removed."""
    paragraphs = []
    for block in re.split(r"\n\s*\n", FENCE.sub("", text.strip())):
        paragraph = " ".join(line.strip() for line in block.splitlines() if line.strip())
        paragraph = EMPHASIS.sub(r"\2", HEADING_PREFIX.sub("", paragraph)).strip()
        if paragraph:
            paragraphs.append(paragraph)
    return paragraphs


def _same_title(paragraph: str, title: str) -> bool:
    def plain(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", value.lower())

    stripped = re.sub(r"^chapter\s+[\divxlc]+\s*[:.\-–—]?\s*", "", paragraph, flags=re.IGNORECASE)
    return bool(plain(title)) and plain(title) in {plain(paragraph), plain(stripped)}


def parse_chapter(text: str, title: str) -> ChapterDraft:
    """Split a written chapter into its prose and the illustration prompts after the marker."""
    match = ILLUSTRATIONS.search(text)
    body, tail = (text[: match.start()], text[match.end() :]) if match else (text, "")
    paragraphs = split_paragraphs(body)
    # The model was told to leave the title to the layout; drop it if it wrote one anyway.
    if len(paragraphs) > 1 and _same_title(paragraphs[0], title):
        paragraphs = paragraphs[1:]
    if not paragraphs:
        raise ServiceError("DeepSeek returned a chapter with no text.")
    illustration_prompts = [LIST_PREFIX.sub("", line).strip() for line in tail.splitlines()]
    return ChapterDraft(paragraphs=paragraphs, illustration_prompts=[p for p in illustration_prompts if p])


def _within_budget(paragraphs: list[str], budget: int) -> str:
    """Whole paragraphs from the start of a text, up to a word budget."""
    kept: list[str] = []
    used = 0
    for paragraph in paragraphs:
        words = len(paragraph.split())
        if kept and used + words > budget:
            kept.append("[…]")
            break
        kept.append(paragraph)
        used += words
    return "\n\n".join(kept)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _planned(raw: Any, known_sections: set[str] | None = None) -> list[PlannedChapter]:
    chapters = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict) or not _text(entry.get("title")):
            continue
        section_ids = entry.get("sourceSectionIds")
        chapters.append(
            PlannedChapter(
                id=_text(entry.get("id")) or None,
                title=_text(entry["title"]),
                summary=_text(entry.get("summary")),
                source_section_ids=[
                    s for s in (section_ids if isinstance(section_ids, list) else [])
                    if isinstance(s, str) and (known_sections is None or s in known_sections)
                ],
            )
        )
    return chapters


class TextService:
    def __init__(self, deepseek: DeepSeek, settings: Settings) -> None:
        self._deepseek = deepseek
        self._settings = settings

    async def plan(self, request: PlanRequest) -> BookPlan:
        if request.kind == "import" and request.mode == "preserve":
            return await self._plan_preserved(request)

        if request.kind == "concept":
            data = await self._deepseek.json(prompts.plan_from_concept(request), temperature=0.8)
            chapters = _planned(data.get("chapters"))
        else:
            known = {section.id for source in request.sources for section in source.sections}
            data = await self._deepseek.json(prompts.plan_adaptation(request), max_tokens=6000, temperature=0.6)
            chapters = _planned(data.get("chapters"), known)
        if not chapters:
            raise ServiceError("DeepSeek returned a plan with no chapters.")
        return BookPlan(
            title=_text(data.get("title")) or "Untitled",
            description=_text(data.get("description")),
            chapters=chapters,
        )

    async def _plan_preserved(self, request: PlanRequest) -> BookPlan:
        """Keeping the text as written: chapters are the source's own sections; the model only describes them."""
        data = await self._deepseek.json(prompts.describe_preserved(request), max_tokens=6000, temperature=0.3)
        summaries = data.get("summaries") if isinstance(data.get("summaries"), dict) else {}
        chapters = []
        for source in request.sources:
            for section in source.sections:
                chapters.append(
                    PlannedChapter(
                        title=section.title or f"Chapter {len(chapters) + 1}",
                        summary=_text(summaries.get(section.id)),
                        source_section_ids=[section.id],
                    )
                )
        source_title = next((s.title for s in request.sources if s.title), None)
        return BookPlan(
            title=source_title or _text(data.get("title")) or "Untitled",
            description=_text(data.get("description")),
            chapters=chapters,
        )

    async def revise_outline(self, request: OutlineRequest) -> OutlineResponse:
        data = await self._deepseek.json(
            prompts.revise_outline(request.brief, request.instruction), max_tokens=6000, temperature=0.4
        )
        known_ids = {chapter.id for chapter in request.brief.chapters}
        chapters = None
        if isinstance(data.get("chapters"), list):
            chapters = _planned(data["chapters"])
            for chapter in chapters:
                # An id the model made up would not match any chapter; treat it as new.
                if chapter.id not in known_ids:
                    chapter.id = None
        return OutlineResponse(chapters=chapters or None, reply=_text(data.get("reply")) or "Done.")

    async def write_chapter(self, request: ChapterRequest) -> ChapterDraft:
        brief = request.brief
        if not 0 <= request.chapter_index < len(brief.chapters):
            raise ServiceError("That chapter is not in the book's outline.", status=400)
        text = await self._deepseek.text(
            prompts.write_chapter(
                brief,
                request.chapter_index,
                _within_budget(request.source_paragraphs, SOURCE_WORD_BUDGET),
                request.instruction,
                self._settings.chapter_words,
            ),
            temperature=0.8,
        )
        return parse_chapter(text, brief.chapters[request.chapter_index].title)

    async def illustration_prompts(self, request: IllustrationPromptsRequest) -> IllustrationPromptsResponse:
        if not 0 <= request.chapter_index < len(request.brief.chapters):
            raise ServiceError("That chapter is not in the book's outline.", status=400)
        count = max(1, min(request.count, 4))
        data = await self._deepseek.json(
            prompts.illustration_prompts(request.brief, request.chapter_index, request.text, count),
            max_tokens=800,
            temperature=0.7,
        )
        raw = data.get("prompts")
        found = [_text(p) for p in (raw if isinstance(raw, list) else []) if _text(p)]
        if not found:
            raise ServiceError("DeepSeek returned no illustration prompts.")
        return IllustrationPromptsResponse(prompts=found[:count])

    async def revise(self, request: ReviseRequest) -> ReviseResponse:
        original = request.text.strip()
        if not original:
            return ReviseResponse(text=request.text)
        # Room for an expansion of the passage; token counts run a little above word counts.
        budget = max(600, min(8000, len(original.split()) * 4 + 400))
        revised = await self._deepseek.text(
            prompts.revise_text(request.brief, original, request.action, request.style),
            max_tokens=budget,
            temperature=REVISION_TEMPERATURE[request.action],
        )
        paragraphs = split_paragraphs(revised)
        return ReviseResponse(text="\n\n".join(paragraphs) or original)

    async def chat(self, request: ChatRequest) -> ChatResponse:
        turns = request.messages[-CHAT_HISTORY_TURNS:]
        if not turns or turns[-1].role != "user":
            raise ServiceError("The conversation has no question to answer.", status=400)
        messages = [{"role": "system", "content": prompts.chat(request.brief, request.chapter_title, request.chapter_text)}]
        messages += [{"role": turn.role, "content": turn.text} for turn in turns]
        answer = await self._deepseek.text(messages, temperature=0.6)

        match = REVISION.search(answer)
        if not match:
            return ChatResponse(reply=answer.strip())
        reply = answer[: match.start()].strip()
        revised = split_paragraphs(answer[match.end() :])
        if revised and request.chapter_title and _same_title(revised[0], request.chapter_title) and len(revised) > 1:
            revised = revised[1:]
        return ChatResponse(reply=reply or "Here is the revised chapter.", revised_chapter=revised or None)
