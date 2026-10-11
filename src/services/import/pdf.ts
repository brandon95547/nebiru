import { sectionize } from './sections'
import type { ParsedDocument } from './types'

interface Line {
  x: number
  y: number
  height: number
  text: string
}

interface TextRun {
  str: string
  transform: number[]
  height: number
}

const SENTENCE_END = /[.!?:]["”’)\]]*$/

/** Rebuild lines from positioned text runs, top to bottom. */
function pageLines(items: TextRun[]): Line[] {
  const lines: Line[] = []
  for (const item of items) {
    if (!item.str.trim()) continue
    const x = item.transform[4]
    const y = item.transform[5]
    const height = item.height || Math.abs(item.transform[3]) || 10
    const line = lines.find((l) => Math.abs(l.y - y) < height * 0.4)
    if (line) {
      line.text += (line.text.endsWith(' ') || item.str.startsWith(' ') ? '' : ' ') + item.str
      line.x = Math.min(line.x, x)
    } else {
      lines.push({ x, y, height, text: item.str })
    }
  }
  return lines.sort((a, b) => b.y - a.y)
}

/** Join lines into paragraphs: a tall gap or an indent after a full stop starts a new one. */
function joinLines(lines: Line[], paragraphs: string[], carry: { open: string }): void {
  if (lines.length === 0) return
  const left = Math.min(...lines.map((l) => l.x))
  let previous: Line | null = null

  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const gap = previous ? previous.y - line.y : 0
    const breaksHere =
      previous !== null &&
      (gap > previous.height * 1.9 || (SENTENCE_END.test(carry.open) && line.x - left > line.height * 0.8))

    if (breaksHere && carry.open) {
      paragraphs.push(carry.open)
      carry.open = ''
    }
    if (/[A-Za-z]-$/.test(carry.open)) carry.open = carry.open.slice(0, -1) + text
    else carry.open = carry.open ? `${carry.open} ${text}` : text
    previous = line
  }
}

export async function parsePdf(data: ArrayBuffer): Promise<ParsedDocument> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const pdf = await pdfjs.getDocument({ data }).promise
  const paragraphs: string[] = []
  const carry = { open: '' }

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    const items = content.items.filter((item) => 'str' in item) as TextRun[]
    joinLines(pageLines(items), paragraphs, carry)
    // A page that ends on a full stop ends its paragraph too.
    if (carry.open && SENTENCE_END.test(carry.open)) {
      paragraphs.push(carry.open)
      carry.open = ''
    }
  }
  if (carry.open) paragraphs.push(carry.open)

  const info = ((await pdf.getMetadata().catch(() => null))?.info ?? {}) as { Title?: string; Author?: string }
  return {
    title: info.Title?.trim() || undefined,
    author: info.Author?.trim() || undefined,
    sections: sectionize(paragraphs),
  }
}
