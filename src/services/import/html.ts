import { sectionsFromBlocks } from './sections'
import type { ParsedDocument, TextBlock } from './types'

const SKIP = new Set([
  'script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript', 'svg', 'form',
  'button', 'iframe', 'head', 'template', 'select', 'video', 'audio', 'canvas',
])
const INLINE = new Set([
  'a', 'span', 'em', 'strong', 'b', 'i', 'u', 'small', 'sub', 'sup', 'code', 'cite',
  'q', 'abbr', 'mark', 'font', 's', 'strike', 'time', 'label', 'big', 'tt', 'var', 'kbd',
])
const TEXT_BLOCK = new Set(['p', 'li', 'pre', 'dt', 'dd', 'figcaption', 'td', 'th'])
const HEADING = /^h([1-6])$/

function clean(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** Flatten an HTML tree into headings and paragraphs in reading order. */
export function extractBlocks(root: Node): TextBlock[] {
  const blocks: TextBlock[] = []
  let loose = ''

  const flushLoose = () => {
    for (const part of loose.split(/\n\s*\n/)) {
      const text = clean(part)
      if (text) blocks.push({ kind: 'text', text })
    }
    loose = ''
  }

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        loose += child.nodeValue ?? ''
        continue
      }
      if (child.nodeType !== 1) continue
      const el = child as Element
      const tag = el.localName.toLowerCase()
      if (SKIP.has(tag)) continue

      const heading = HEADING.exec(tag)
      if (heading) {
        flushLoose()
        const text = clean(el.textContent)
        if (text) blocks.push({ kind: 'heading', level: Number(heading[1]), text })
      } else if (TEXT_BLOCK.has(tag)) {
        flushLoose()
        const text = clean(el.textContent)
        if (text) blocks.push({ kind: 'text', text })
      } else if (tag === 'br') {
        loose += '\n'
      } else if (INLINE.has(tag)) {
        loose += el.textContent ?? ''
      } else {
        flushLoose()
        walk(el)
        flushLoose()
      }
    }
  }

  walk(root)
  flushLoose()
  return blocks
}

export function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

export function parseHtml(html: string): ParsedDocument {
  const doc = parseHtmlDocument(html)
  const author = doc.querySelector('meta[name="author" i]')?.getAttribute('content') ?? undefined
  return {
    title: clean(doc.title) || undefined,
    author: author ? clean(author) : undefined,
    sections: sectionsFromBlocks(extractBlocks(doc.body)),
  }
}
