"""The light markup that carries a page's structure inside plain paragraphs.

    ## A section heading          (### for a smaller one)
    1. A numbered entry           (the page's own numbers are kept)
    - A bulleted entry
    A paragraph. Lines that matter, as in verse, stay on separate lines.

The app turns these into real headings and lists when it builds a page.
"""

from __future__ import annotations

import re

FENCE = re.compile(r"^```[a-z]*\s*$", re.IGNORECASE)
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
NUMBERED = re.compile(r"^(\d{1,3})[.)]\s+(.*)$")
BULLET = re.compile(r"^[-*•]\s+(.*)$")
EMPHASIS = re.compile(r"(\*\*|__)(.+?)\1")


def parse_marked_text(text: str, *, take_title: bool = False) -> tuple[str | None, list[str]]:
    """Split marked-up text into paragraphs, markup kept.

    With `take_title` the page's title is separated out: a "# " line, or failing
    that a short unpunctuated opening line. Without it every "# " line is an
    ordinary heading and the title is None.
    """
    title: str | None = None
    paragraphs: list[str] = []
    open_lines: list[str] = []

    def flush() -> None:
        if open_lines:
            paragraphs.append("\n".join(open_lines))
            open_lines.clear()

    for raw in text.strip().splitlines():
        line = EMPHASIS.sub(r"\2", raw.strip())
        if FENCE.match(line):
            continue
        if not line:
            flush()
            continue
        heading = HEADING.match(line)
        if heading:
            flush()
            words = heading.group(2).strip().rstrip("#").strip()
            if not words:
                continue
            if take_title and len(heading.group(1)) == 1 and title is None and not paragraphs:
                title = words
            else:
                paragraphs.append(f"{'###' if len(heading.group(1)) > 2 else '##'} {words}")
            continue
        numbered = NUMBERED.match(line)
        if numbered:
            flush()
            paragraphs.append(f"{numbered.group(1)}. {numbered.group(2).strip()}")
            continue
        bullet = BULLET.match(line)
        if bullet:
            flush()
            paragraphs.append(f"- {bullet.group(1).strip()}")
            continue
        open_lines.append(line)
    flush()
    if take_title and title is None and len(paragraphs) > 1 and _reads_as_title(paragraphs[0]):
        title = paragraphs.pop(0)
    return title, paragraphs


def _reads_as_title(paragraph: str) -> bool:
    """A short unpunctuated opening line is the page's title even when it was not marked as one."""
    return (
        "\n" not in paragraph
        and len(paragraph) <= 80
        and len(paragraph.split()) <= 10
        and not paragraph.startswith(("#", "-"))
        and not NUMBERED.match(paragraph)
        and paragraph[-1] not in ".!?,;:"
    )
