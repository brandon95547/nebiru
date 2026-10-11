"""Prompts for the writing model.

Each builder returns the messages for one request. They are written the way a
brief to a capable colleague would be: who the reader is, what the output is
for, and what shape it must take, rather than a list of rigid rules.
"""

from __future__ import annotations

from .schemas import Brief, PlanRequest

ILLUSTRATION_MARKER = "===ILLUSTRATIONS==="
REVISION_MARKER = "===REVISED CHAPTER==="

ROLE = (
    "You are the writing engine inside Nebiru, a studio where a person creates an illustrated book. "
    "What you return is placed straight into their book or their planning screen, and they read and "
    "edit it there, so write the finished thing itself: no greetings, no notes about what you did, "
    "no markdown formatting."
)

PLAIN_PROSE = (
    "Write plain prose: paragraphs separated by one blank line, no headings, no markdown, no lists "
    "unless the material truly is a list. Do not include the chapter title; the page layout adds it."
)

ILLUSTRATION_BRIEF = (
    "Each illustration prompt is one sentence describing a single concrete scene from the chapter for an "
    "illustrator: the subject, what they are doing, the setting and the mood. Describe what is seen, not "
    "ideas. Leave out any art style, medium or artist, because the book's illustration style is applied "
    "separately, and never ask for words or lettering in the picture."
)


def _words(text: str, limit: int) -> str:
    """The first `limit` words of a text, marked when it was cut."""
    words = text.split()
    if len(words) <= limit:
        return text.strip()
    return " ".join(words[:limit]) + " […]"


def _book_card(brief: Brief) -> str:
    lines = [f"Title: {brief.title or 'Untitled'}"]
    if brief.author:
        lines.append(f"Author: {brief.author}")
    if brief.description:
        lines.append(f"About the book: {brief.description}")
    if brief.origin.kind == "concept" and brief.origin.concept:
        lines.append(f"The author's original concept: {brief.origin.concept}")
    if brief.origin.instruction:
        lines.append(f"What the author asked Nebiru to make: {brief.origin.instruction}")
    return "\n".join(lines)


def _outline(brief: Brief, current: int | None = None) -> str:
    lines = []
    for index, chapter in enumerate(brief.chapters):
        marker = "  <- this chapter" if index == current else ""
        summary = f": {chapter.summary}" if chapter.summary else ""
        lines.append(f"{index + 1}. {chapter.title}{summary}{marker}")
    return "\n".join(lines) or "(no chapters yet)"


# --- planning ---------------------------------------------------------------


def plan_from_concept(request: PlanRequest) -> list[dict[str, str]]:
    user = f"""The author wants to make this book:

{request.concept.strip()}

Plan it. Return a JSON object with these keys:
- "title": a title a reader would pick up. Make it specific to this book rather than a restatement of the request.
- "description": two or three sentences in the voice of a back-cover blurb, telling a reader what the book is and why they would want it.
- "chapters": an array of about {request.chapter_count} objects, each with "title" and "summary".

Chapter titles are the names of the chapters only, without "Chapter 1" style numbering, which the layout adds. Each summary is one to three sentences saying concretely what that chapter covers or what happens in it, precise enough that the chapter could be written from it. Together the chapters should build: an opening that earns attention, a middle that develops, an ending that lands."""
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": user}]


def _request_note(request: PlanRequest) -> str:
    """The author's own instruction for an import, as a paragraph for a planning prompt."""
    if not request.instruction.strip():
        return ""
    return (
        f"\n\nThe author also said what they want made from this material:\n{request.instruction.strip()}\n"
        "Let that guide the plan wherever it applies."
    )


def _source_index(request: PlanRequest) -> str:
    blocks = []
    for source in request.sources:
        header = f"FILE: {source.name}"
        if source.title:
            header += f" (titled “{source.title}”)"
        if source.author:
            header += f" by {source.author}"
        blocks.append(header)
        for section in source.sections:
            title = section.title or "(untitled section)"
            blocks.append(f"[{section.id}] {title}, {section.word_count} words. Opens: {_words(section.excerpt, 90)}")
    return "\n".join(blocks)


def plan_reworded(request: PlanRequest) -> list[dict[str, str]]:
    user = f"""The author has imported a text and is making a new book from it: one that says exactly what the original says, section by section and in the same order, in entirely different words. The planning screen needs a title and description for the new book and, for each section, a chapter title and a short summary.

Here is an index of the source. Each line gives a section id in square brackets, its title, its length and how it opens.

{_source_index(request)}{_request_note(request)}

Return a JSON object with these keys:
- "title": a title for the new book, in different words from the source's own title.
- "description": two or three sentences in the voice of a back-cover blurb.
- "chapters": an object mapping each section id, copied exactly, to an object with "title" and "summary".

Each chapter title names what its section covers in your own words rather than repeating the source's heading, and carries no "Chapter 1" numbering. Where a section is plainly front or back matter (an introduction, a dedication, a table of contents, a copyright notice), give it that plain label. Each summary is one sentence based on the section's title and opening."""
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": user}]


def reword_passage(brief: Brief, chapter_title: str, passage: str) -> list[dict[str, str]]:
    user = f"""{_book_card(brief)}

The author is making a new book that says exactly what an existing text says, in entirely different words. This passage is from the part that becomes the chapter “{chapter_title}”.

PASSAGE:
{passage}

Rewrite the passage. Carry over everything it says: every fact, idea, instruction, example, name and event, in the same order and at about the same length, so that a reader learns from your version exactly what they would have learned from the original. Carry over none of its wording: build new sentences with their own structure and vocabulary rather than swapping in synonyms, so that no sentence and no distinctive phrase of the original remains. Keep proper names, numbers, dates and technical terms as they are, and keep anything the passage quotes from someone else as a quotation.

Do not summarise, shorten, comment, or add anything the passage does not say. Do not sharpen or soften what it says either: a quantity, a condition or a degree of certainty stays exactly what it was.

Keep the passage's layout. A line starting with "## " is a heading: keep the marker and reword the heading. A line starting with a number and a full stop, such as "3. ", or with "- ", is a list entry: keep the marker and reword the entry. Where the passage sets lines of verse on separate lines, write the same number of lines. Separate paragraphs with one blank line. Give the passage no title or heading it does not already have.

Return only the rewritten passage."""
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": user}]


def describe_preserved(request: PlanRequest) -> list[dict[str, str]]:
    user = f"""The author has imported a finished text and is keeping it exactly as written; Nebiru will lay it out and illustrate it. The planning screen needs a description of the book and a short summary of each section, so the author can see what is where.

Here is an index of the text. Each line gives a section id in square brackets, its title, its length and how it opens.

{_source_index(request)}{_request_note(request)}

Return a JSON object with these keys:
- "title": the book's title. Use the title given in the index if there is one; otherwise propose a fitting one.
- "description": two or three sentences describing the book for a reader.
- "summaries": an object mapping each section id, copied exactly, to a one-sentence summary of that section based on its title and opening. Where a section is plainly front or back matter (a copyright notice, a table of contents, a licence), say so in its summary."""
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": user}]


def revise_outline(brief: Brief, instruction: str) -> list[dict[str, str]]:
    chapters = "\n".join(
        f'{number}. id "{chapter.id}" | {chapter.title} | {chapter.summary or "(no summary)"}'
        for number, chapter in enumerate(brief.chapters, start=1)
    )
    user = f"""{_book_card(brief)}

The book's table of contents, in order. Each line is the chapter's number, then id | title | summary. When the author says "chapter 3" they mean the line numbered 3; the ids are internal labels and say nothing about order.
{chapters or "(empty)"}

The author says:
{instruction.strip()}

Return a JSON object with these keys:
- "reply": one or two sentences to the author saying what you changed, or answering them if they asked a question.
- "chapters": the complete revised table of contents in order, as an array of objects with "id", "title" and "summary". If the author asked a question and nothing should change, use null instead.

A chapter that continues an existing one keeps that chapter's id, even if you retitle, rewrite or move it, because its written text follows the id. A brand-new chapter has "id": null. Leave out any chapter being removed. Titles carry no "Chapter 1" numbering. Change what the author asked for and keep everything else as it is."""
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": user}]


# --- writing ----------------------------------------------------------------


def write_chapter(
    brief: Brief, chapter_index: int, source_text: str, instruction: str | None, target_words: int
) -> list[dict[str, str]]:
    chapter = brief.chapters[chapter_index]
    illustrations = 1 if target_words < 1800 else 2

    parts = [
        _book_card(brief),
        f"The full table of contents:\n{_outline(brief, chapter_index)}",
        f"Write chapter {chapter_index + 1}, “{chapter.title}”."
        + (f" It should cover: {chapter.summary}" if chapter.summary else ""),
    ]
    if source_text:
        parts.append(
            "This chapter restates existing source material in new words. The source follows. Say what it "
            "says, in your own sentences and your own wording, following the author's direction where it "
            "applies; do not reuse the source's sentences, and do not invent facts it does not support.\n\n"
            f"SOURCE MATERIAL:\n{source_text}"
        )
    if instruction:
        parts.append(f"The author's direction for this version of the chapter: {instruction.strip()}")
    parts.append(
        f"Aim for about {target_words} words. Write it to be read: stay inside this chapter's part of the "
        "outline without retelling earlier chapters or running ahead into later ones, and end where the "
        f"chapter ends rather than summarising it. {PLAIN_PROSE}"
    )
    parts.append(
        f"After the chapter, on a line by itself, write {ILLUSTRATION_MARKER} and then {illustrations} "
        f"illustration prompt{'s' if illustrations > 1 else ''}, one per line. {ILLUSTRATION_BRIEF}"
    )
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": "\n\n".join(parts)}]


def illustration_prompts(brief: Brief, chapter_index: int, text: str, count: int) -> list[dict[str, str]]:
    chapter = brief.chapters[chapter_index]
    user = f"""{_book_card(brief)}

Chapter {chapter_index + 1}, “{chapter.title}”, reads:

{_words(text, 2500)}

Choose {count} moment{'s' if count > 1 else ''} from this chapter that would make the strongest illustration{'s' if count > 1 else ''}, spread through the chapter rather than bunched together. If the page is a list, an index or a table of contents rather than a narrative, describe instead an emblem or a scene that stands for the book as a whole. Where the author's request says how the book should look or feel, let the subject and mood of the picture follow it. {ILLUSTRATION_BRIEF}

Return a JSON object with one key, "prompts": an array of {count} string{'s' if count > 1 else ''}."""
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": user}]


REVISIONS = {
    "grammar": (
        "Correct the grammar, spelling and punctuation. Change nothing else: keep the author's wording, "
        "voice, meaning and paragraph breaks, and leave correct sentences exactly as they are."
    ),
    "rewrite": (
        "Rewrite it so it reads better: clearer, more vivid, better paced. Keep the meaning, the facts, "
        "the point of view and roughly the same length."
    ),
    "expand": (
        "The passage is {words} words. Expand it to about {double} words by developing what is already "
        "there: more concrete detail, fuller description, the steps or beats it currently skips. Do not add "
        "new plot turns or new claims."
    ),
    "shorten": (
        "The passage is {words} words. Cut it to about {half} words. Keep what matters most and the "
        "author's voice; remove repetition, throat-clearing and anything the passage does not need."
    ),
}


def revise_text(brief: Brief, text: str, action: str, style: str | None) -> list[dict[str, str]]:
    if action == "style":
        task = (
            f"Rewrite it in this style: {style or 'clear and direct'}. Keep the meaning, the facts and "
            "roughly the same length; change the voice, rhythm and word choice."
        )
    else:
        # A word target works where "half" or "twice" alone gets a timid trim.
        words = len(text.split())
        task = REVISIONS[action].format(words=words, half=max(1, words // 2), double=words * 2)
    user = f"""{_book_card(brief)}

Here is a passage from the book:

{text.strip()}

{task}

Return only the revised passage, ready to replace the original in the book. If it has more than one paragraph, separate them with one blank line."""
    return [{"role": "system", "content": ROLE}, {"role": "user", "content": user}]


def chat(brief: Brief, chapter_title: str | None, chapter_text: str | None) -> str:
    """System prompt for the assistant panel; the conversation follows as chat turns."""
    parts = [
        "You are the assistant inside Nebiru, a studio where a person creates an illustrated book. You are "
        "talking with the author in a side panel while they edit. Be direct and specific to their book, and "
        "keep replies short enough to read in a narrow panel. Reply in plain text without markdown.",
        f"THE BOOK\n{_book_card(brief)}",
        f"TABLE OF CONTENTS\n{_outline(brief)}",
    ]
    if chapter_title and chapter_text:
        parts.append(f"THE CHAPTER THE AUTHOR HAS OPEN: “{chapter_title}”\n\n{_words(chapter_text, 9000)}")
        parts.append(
            "If the author asks for a change to the text of the open chapter, make it. Reply with a sentence "
            f"or two saying what you changed, then put {REVISION_MARKER} on a line by itself, followed by the "
            "complete chapter text with the change made. Include every paragraph, changed or not, separated "
            "by blank lines, with no chapter title, because your version replaces the chapter as a whole "
            "once the author accepts it. Change only what they asked for. If they are asking a question, "
            "wanting advice, or asking about something other than this chapter's text, just answer and do "
            "not include that line."
        )
    else:
        parts.append(
            "The author has no chapter open, so you can discuss and advise but cannot change text. If they "
            "ask for an edit, tell them to click into the chapter they mean first."
        )
    return "\n\n".join(parts)
