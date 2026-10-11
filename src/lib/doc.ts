import type { JSONContent } from '@tiptap/core'
import type { IllustrationAttrs } from '@/types'
import { countWords, uid } from './util'

/** Helpers for chapter documents (Tiptap JSON), usable without an editor. */

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/** A paragraph. Line breaks inside the text are kept as breaks on the page (verse, addresses). */
export function paragraphNode(text: string): JSONContent {
  const content: JSONContent[] = []
  text.split('\n').forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line })
  })
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

const HEADING = /^(#{2,3})\s+(.+)$/s
const NUMBERED = /^(\d{1,3})[.)]\s+(.+)$/s
const BULLET = /^[-•]\s+(.+)$/s

/**
 * Turn source paragraphs into document nodes. Importers keep structure as
 * light markup at the start of a paragraph, which is read here:
 *
 *   "## Heading"   a section heading ("###" for a smaller one)
 *   "3. Entry"     a numbered list entry, keeping its own number
 *   "- Entry"      a bulleted list entry
 */
export function paragraphsToNodes(paragraphs: string[]): JSONContent[] {
  const nodes: JSONContent[] = []
  for (const text of paragraphs) {
    const heading = HEADING.exec(text)
    if (heading) {
      nodes.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: [{ type: 'text', text: heading[2].trim().replace(/\s*\n\s*/g, ' ') }],
      })
      continue
    }

    const numbered = NUMBERED.exec(text)
    const bullet = numbered ? null : BULLET.exec(text)
    if (!numbered && !bullet) {
      nodes.push(paragraphNode(text))
      continue
    }

    const item: JSONContent = { type: 'listItem', content: [paragraphNode((numbered?.[2] ?? bullet![1]).trim())] }
    const previous = nodes[nodes.length - 1]
    if (bullet) {
      if (previous?.type === 'bulletList') previous.content!.push(item)
      else nodes.push({ type: 'bulletList', content: [item] })
      continue
    }
    // A numbered entry joins the list above it only if it carries the next number;
    // a restart ("1." again under a new heading) begins a list of its own.
    const number = Number(numbered![1])
    const follows =
      previous?.type === 'orderedList' && (previous.attrs?.start ?? 1) + previous.content!.length === number
    if (follows) previous.content!.push(item)
    else nodes.push({ type: 'orderedList', attrs: { start: number }, content: [item] })
  }
  return nodes
}

export function newIllustration(partial: Partial<IllustrationAttrs> = {}): IllustrationAttrs {
  return {
    id: uid('ill'),
    src: '',
    prompt: '',
    placement: 'right',
    widthPct: 44,
    aspect: 4 / 5,
    status: 'empty',
    caption: '',
    seed: null,
    ...partial,
  }
}

export function illustrationNode(attrs: IllustrationAttrs): JSONContent {
  return { type: 'illustration', attrs: { ...attrs } }
}

/**
 * Build a chapter document from source paragraphs, spreading the given
 * illustrations through the text. New illustrations alternate sides, the
 * first beside the opening paragraphs; with `keepPlacement` each one keeps
 * the position the author already gave it. `lead` puts the first one above
 * everything, centred, which suits a page that is a list rather than prose.
 */
export function buildChapterDoc(
  paragraphs: string[],
  illustrations: IllustrationAttrs[],
  options: { keepPlacement?: boolean; lead?: boolean } = {},
): JSONContent {
  const nodes = paragraphsToNodes(paragraphs)
  const blocks = nodes.length
  const count = illustrations.length
  // Insert back to front so earlier insert positions stay valid.
  for (let i = count - 1; i >= 0; i--) {
    if (options.lead && i === 0) {
      nodes.unshift(illustrationNode({ ...illustrations[0], placement: 'center' }))
      continue
    }
    const at = Math.min(nodes.length, Math.max(1, Math.round(((i + 0.12) * blocks) / count)))
    const placement = options.keepPlacement ? illustrations[i].placement : i % 2 === 0 ? 'right' : 'left'
    nodes.splice(at, 0, illustrationNode({ ...illustrations[i], placement }))
  }
  if (nodes.length === 0) nodes.push({ type: 'paragraph' })
  return { type: 'doc', content: nodes }
}

function walk(node: JSONContent, visit: (node: JSONContent) => void): void {
  visit(node)
  node.content?.forEach((child) => walk(child, visit))
}

export function listIllustrations(doc: JSONContent | null): IllustrationAttrs[] {
  const found: IllustrationAttrs[] = []
  if (doc) {
    walk(doc, (node) => {
      if (node.type === 'illustration' && node.attrs) found.push(node.attrs as IllustrationAttrs)
    })
  }
  return found
}

/** Return a copy of the document with every illustration passed through `map`. */
export function mapIllustrations(
  doc: JSONContent,
  map: (attrs: IllustrationAttrs) => IllustrationAttrs,
): JSONContent {
  if (doc.type === 'illustration' && doc.attrs) {
    return { ...doc, attrs: map(doc.attrs as IllustrationAttrs) }
  }
  if (!doc.content) return doc
  return { ...doc, content: doc.content.map((child) => mapIllustrations(child, map)) }
}

export function patchIllustration(
  doc: JSONContent,
  id: string,
  patch: Partial<IllustrationAttrs>,
): JSONContent {
  return mapIllustrations(doc, (attrs) => (attrs.id === id ? { ...attrs, ...patch } : attrs))
}

function nodeText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(nodeText).join('')
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading'])

/** Plain text of a document, one block per paragraph. */
export function docText(doc: JSONContent | null): string {
  const blocks: string[] = []
  if (doc) {
    walk(doc, (node) => {
      if (node.type && TEXT_BLOCKS.has(node.type)) {
        const text = nodeText(node).trim()
        if (text) blocks.push(text)
      }
    })
  }
  return blocks.join('\n\n')
}

export function docWordCount(doc: JSONContent | null): number {
  return countWords(docText(doc))
}
