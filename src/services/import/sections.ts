import { countWords } from '@/lib/util'
import type { ParsedSection, TextBlock } from './types'

/** Grouping imported text into chapter-sized sections. */

const NUMBER_WORD =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty'
const NUMBERED = new RegExp(
  `^(?:chapter|part|book|section|act|canto|lesson)\\s+(?:\\d+|[ivxlcdm]+|(?:${NUMBER_WORD})(?:[- ](?:${NUMBER_WORD}))?)\\b`,
  'i',
)
const NAMED =
  /^(?:prologue|epilogue|introduction|preface|foreword|afterword|appendix|conclusion|interlude|acknowledge?ments|dedication|about the author)\b/i
const BARE_NUMBER = /^(?:\d{1,3}|[IVXLCDM]{1,7})\.?$/

const MAX_HEADING_LENGTH = 80
const LONG_SECTION_WORDS = 6000
const SPLIT_TARGET_WORDS = 3000

export function isHeadingLine(text: string): boolean {
  if (text.length > MAX_HEADING_LENGTH) return false
  if (BARE_NUMBER.test(text)) return true
  if (/[.!?,;]$/.test(text)) return false
  return NUMBERED.test(text) || NAMED.test(text)
}

/** A short unpunctuated line right after "Chapter 3" is that chapter's name. */
function isSubtitle(text: string): boolean {
  return text.length <= 60 && !/[.!?,;:]$/.test(text) && countWords(text) <= 9 && !isHeadingLine(text)
}

/** Split a flat run of paragraphs wherever a line reads as a chapter heading. */
export function sectionize(paragraphs: string[]): ParsedSection[] {
  const sections: ParsedSection[] = []
  let current: ParsedSection = { title: null, paragraphs: [] }

  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i]
    if (!isHeadingLine(text)) {
      current.paragraphs.push(text)
      continue
    }
    sections.push(current)
    let title = text
    const next = paragraphs[i + 1]
    if (next !== undefined && isSubtitle(next)) {
      title = `${text.replace(/[.:]$/, '')}: ${next}`
      i++
    }
    current = { title, paragraphs: [] }
  }
  sections.push(current)

  const filled = sections.filter((s) => s.paragraphs.length > 0)
  return filled.length === 1 && filled[0].title === null ? splitLong(filled[0]) : filled
}

/** Break one long untitled run into parts of a workable length. */
function splitLong(section: ParsedSection): ParsedSection[] {
  const total = countWords(section.paragraphs.join(' '))
  if (total <= LONG_SECTION_WORDS) return [section]

  const parts: ParsedSection[] = []
  let bucket: string[] = []
  let words = 0
  for (const paragraph of section.paragraphs) {
    bucket.push(paragraph)
    words += countWords(paragraph)
    if (words >= SPLIT_TARGET_WORDS) {
      parts.push({ title: `Part ${parts.length + 1}`, paragraphs: bucket })
      bucket = []
      words = 0
    }
  }
  if (bucket.length > 0) {
    // A short tail reads better attached to the previous part.
    if (parts.length > 0 && words < SPLIT_TARGET_WORDS / 3) parts[parts.length - 1].paragraphs.push(...bucket)
    else parts.push({ title: `Part ${parts.length + 1}`, paragraphs: bucket })
  }
  return parts
}

/**
 * Group structured blocks into sections. Sections break on the shallowest
 * heading level that occurs more than once; deeper headings stay in the text.
 * Without usable headings, fall back to reading chapter markers in the prose.
 */
export function sectionsFromBlocks(blocks: TextBlock[]): ParsedSection[] {
  const counts = new Map<number, number>()
  for (const block of blocks) {
    if (block.kind === 'heading') counts.set(block.level, (counts.get(block.level) ?? 0) + 1)
  }
  const splitLevel = [...counts.keys()].sort((a, b) => a - b).find((level) => (counts.get(level) ?? 0) > 1)

  if (splitLevel === undefined) {
    return sectionize(blocks.map((b) => b.text))
  }

  const sections: ParsedSection[] = []
  let current: ParsedSection = { title: null, paragraphs: [] }
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === splitLevel) {
      sections.push(current)
      current = { title: block.text, paragraphs: [] }
    } else if (block.kind === 'text') {
      current.paragraphs.push(block.text)
    } else if (block.level > splitLevel) {
      // A heading inside a chapter stays a heading on the page. Shallower ones
      // are document titles, not body text, and are dropped.
      current.paragraphs.push(`## ${block.text}`)
    }
  }
  sections.push(current)
  return sections.filter((s) => s.paragraphs.length > 0)
}
