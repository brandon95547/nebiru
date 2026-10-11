import type { JSONContent } from '@tiptap/core'
import type { IllustrationAttrs } from '@/types'
import { countWords, uid } from './util'

/** Helpers for chapter documents (Tiptap JSON), usable without an editor. */

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function paragraphNode(text: string): JSONContent {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }
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
 * Build a chapter document from plain paragraphs, spreading the given
 * illustrations through the text. New illustrations alternate sides, the
 * first beside the opening paragraphs; with `keepPlacement` each one keeps
 * the position the author already gave it.
 */
export function buildChapterDoc(
  paragraphs: string[],
  illustrations: IllustrationAttrs[],
  options: { keepPlacement?: boolean } = {},
): JSONContent {
  const nodes: JSONContent[] = paragraphs.map(paragraphNode)
  const count = illustrations.length
  // Insert back to front so earlier insert positions stay valid.
  for (let i = count - 1; i >= 0; i--) {
    const at = Math.min(nodes.length, Math.max(1, Math.round(((i + 0.12) * paragraphs.length) / count)))
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
