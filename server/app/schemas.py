"""Request and response shapes. The wire format is camelCase to match the app."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- shared -----------------------------------------------------------------


class Origin(Model):
    kind: Literal["concept", "import"]
    concept: str = ""
    mode: Literal["preserve", "adapt"] | None = None
    # What the author asked Nebiru to make from imported material.
    instruction: str = ""


class BriefChapter(Model):
    id: str
    title: str
    summary: str = ""


class Brief(Model):
    """Compact description of the book, sent with every request as context."""

    title: str
    author: str = ""
    description: str = ""
    origin: Origin
    chapters: list[BriefChapter] = Field(default_factory=list)


class PlannedChapter(Model):
    id: str | None = None
    title: str
    summary: str = ""
    source_section_ids: list[str] = Field(default_factory=list)


# --- planning ---------------------------------------------------------------


class SectionDigest(Model):
    """One section of imported material: enough to plan from, not the full text."""

    id: str
    title: str | None = None
    word_count: int = 0
    excerpt: str = ""


class SourceDigest(Model):
    name: str
    title: str | None = None
    author: str | None = None
    sections: list[SectionDigest] = Field(default_factory=list)


class PlanRequest(Model):
    kind: Literal["concept", "import"]
    concept: str = ""
    chapter_count: int = 10
    mode: Literal["preserve", "adapt"] | None = None
    instruction: str = ""
    sources: list[SourceDigest] = Field(default_factory=list)


class BookPlan(Model):
    title: str
    description: str
    chapters: list[PlannedChapter]


class OutlineRequest(Model):
    brief: Brief
    instruction: str


class OutlineResponse(Model):
    chapters: list[PlannedChapter] | None = None
    reply: str


# --- writing ----------------------------------------------------------------


class ChapterRequest(Model):
    brief: Brief
    chapter_index: int
    source_paragraphs: list[str] = Field(default_factory=list)
    instruction: str | None = None


class ChapterDraft(Model):
    paragraphs: list[str]
    illustration_prompts: list[str]


class IllustrationPromptsRequest(Model):
    brief: Brief
    chapter_index: int
    text: str
    count: int = 1


class IllustrationPromptsResponse(Model):
    prompts: list[str]


class ReviseRequest(Model):
    brief: Brief
    text: str
    action: Literal["grammar", "rewrite", "expand", "shorten", "style"]
    style: str | None = None


class ReviseResponse(Model):
    text: str
    note: str | None = None


class ChatTurn(Model):
    role: Literal["user", "assistant"]
    text: str


class ChatRequest(Model):
    brief: Brief
    messages: list[ChatTurn]
    chapter_title: str | None = None
    chapter_text: str | None = None


class ChatResponse(Model):
    reply: str
    revised_chapter: list[str] | None = None


# --- reading images ---------------------------------------------------------


class PageText(Model):
    """The text of one uploaded page image. Structure is kept as markup in the paragraphs."""

    title: str | None = None
    paragraphs: list[str]


# --- illustration -----------------------------------------------------------


class IllustrationRequest(Model):
    prompt: str
    style_id: str
    aspect: float = Field(gt=0.2, lt=5)
    purpose: Literal["interior", "cover"] = "interior"
    seed: int | None = None


class IllustrationResponse(Model):
    src: str
    seed: int


# --- status -----------------------------------------------------------------


class ServiceState(Model):
    available: bool
    detail: str = ""


class Status(Model):
    text: ServiceState
    illustration: ServiceState
