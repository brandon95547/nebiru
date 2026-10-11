import { sectionize, sectionsFromBlocks } from './sections'
import type { ParsedDocument, TextBlock } from './types'

function normalize(raw: string): string {
  return raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

/** Paragraphs are separated by blank lines; without any, every line is one. */
function toBlocks(text: string): string[] {
  const chunks = /\n[ \t]*\n/.test(text) ? text.split(/\n[ \t]*\n+/) : text.split('\n')
  return chunks.map((chunk) => chunk.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const MAX_TITLE_LENGTH = 80

export function parsePlainText(raw: string): ParsedDocument {
  const sections = sectionize(toBlocks(normalize(raw)))
  // A lone short line ahead of the first chapter heading is the book's title, not a chapter.
  const [lead, ...rest] = sections
  if (rest.length > 0 && lead.title === null && lead.paragraphs.length === 1 && lead.paragraphs[0].length <= MAX_TITLE_LENGTH) {
    return { title: lead.paragraphs[0], sections: rest }
  }
  return { sections }
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

export function parseMarkdown(raw: string): ParsedDocument {
  const blocks: TextBlock[] = []
  let open: string[] = []

  const flush = () => {
    const text = stripInlineMarkdown(open.join(' ').replace(/\s+/g, ' '))
    if (text) blocks.push({ kind: 'text', text })
    open = []
  }

  for (const line of normalize(raw).split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (heading) {
      flush()
      const text = stripInlineMarkdown(heading[2].replace(/\s*#+\s*$/, ''))
      if (text) blocks.push({ kind: 'heading', level: heading[1].length, text })
    } else if (!line.trim() || /^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      flush()
    } else {
      open.push(line.replace(/^\s*(?:>+|[-*+]|\d+[.)])\s+/, ''))
    }
  }
  flush()

  const topHeadings = blocks.filter((b) => b.kind === 'heading' && b.level === 1)
  const title = topHeadings.length === 1 ? topHeadings[0].text : undefined
  return { title, sections: sectionsFromBlocks(blocks) }
}
