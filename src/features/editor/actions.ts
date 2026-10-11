import { NodeSelection } from '@tiptap/pm/state'
import { buildChapterDoc, EMPTY_DOC, illustrationNode, listIllustrations, newIllustration } from '@/lib/doc'
import { services } from '@/services'
import { briefOf } from '@/services/generation'
import type { RevisionAction } from '@/services/text/types'
import { activeEditor, liveEditor } from '@/store/editorHub'
import { setChapterContent } from '@/store/library'
import type { Book, Chapter } from '@/types'

/** Editing operations triggered from the panels around the page. */

export interface ReviseOutcome {
  changed: number
  note?: string
}

const STALE = 'The text changed while the assistant was working, so nothing was replaced.'

/**
 * Revise the selected text, or the paragraph holding the cursor. A selection
 * inside one paragraph is replaced in place; anything wider is revised
 * paragraph by paragraph and applied as a single undoable step.
 */
export async function reviseSelection(book: Book, action: RevisionAction, style?: string): Promise<ReviseOutcome> {
  const editor = activeEditor()
  if (!editor) return { changed: 0, note: 'Click into the text you want to change first.' }

  const brief = briefOf(book)
  const { doc, selection } = editor.state
  const { from, to, empty, $from, $to } = selection

  if (!empty && $from.sameParent($to) && $from.parent.isTextblock) {
    const original = doc.textBetween(from, to)
    const result = await services.text.reviseText({ brief, text: original, action, style })
    if (editor.isDestroyed) return { changed: 0 }
    const current = editor.state.doc
    if (to > current.content.size || current.textBetween(from, to) !== original) return { changed: 0, note: STALE }
    if (result.text === original) return { changed: 0, note: result.note }
    editor.view.dispatch(editor.state.tr.insertText(result.text.replace(/\s*\n+\s*/g, ' '), from, to))
    return { changed: 1, note: result.note }
  }

  const targets: Array<{ pos: number; text: string }> = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'paragraph') return true
    if (node.textContent.trim()) targets.push({ pos, text: node.textContent })
    return false
  })
  if (targets.length === 0) return { changed: 0, note: 'There is no text here to revise.' }

  const results = await Promise.all(
    targets.map((target) => services.text.reviseText({ brief, text: target.text, action, style })),
  )
  if (editor.isDestroyed) return { changed: 0 }

  const { schema, tr } = editor.state
  let changed = 0
  let stale = false
  // Work backwards so earlier positions stay valid as paragraphs are replaced.
  for (let i = targets.length - 1; i >= 0; i--) {
    const { pos, text } = targets[i]
    const node = pos < tr.doc.content.size ? tr.doc.nodeAt(pos) : null
    if (!node || node.type.name !== 'paragraph' || node.textContent !== text) {
      stale = true
      continue
    }
    const parts = results[i].text
      .split(/\n{2,}/)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (parts.length === 0 || (parts.length === 1 && parts[0] === text)) continue
    tr.replaceWith(
      pos,
      pos + node.nodeSize,
      parts.map((part) => schema.nodes.paragraph.create(null, schema.text(part))),
    )
    changed++
  }
  if (changed > 0) editor.view.dispatch(tr)
  return { changed, note: results.find((result) => result.note)?.note ?? (stale ? STALE : undefined) }
}

/** Insert an empty illustration above the block holding the cursor and select it. */
export function insertIllustrationAtCursor(): boolean {
  const editor = activeEditor()
  if (!editor) return false
  const { $from } = editor.state.selection
  const pos = $from.depth > 0 ? $from.before(1) : $from.pos
  const node = editor.schema.nodeFromJSON(illustrationNode(newIllustration()))
  const tr = editor.state.tr.insert(pos, node)
  tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}

/** Put an empty illustration at the top of a chapter, whether or not its editor is open. */
export function insertIllustrationAtStart(bookId: string, chapter: Chapter): void {
  const json = illustrationNode(newIllustration())
  const editor = liveEditor(chapter.id)
  if (editor) {
    const tr = editor.state.tr.insert(0, editor.schema.nodeFromJSON(json))
    tr.setSelection(NodeSelection.create(tr.doc, 0))
    editor.view.dispatch(tr)
    editor.view.focus()
    return
  }
  const doc = chapter.content ?? EMPTY_DOC
  setChapterContent(bookId, chapter.id, { ...doc, content: [json, ...(doc.content ?? [])] }, true)
}

/**
 * Replace a chapter's text with a version the assistant rewrote. The
 * chapter's illustrations are kept and spread through the new text.
 */
export function applyChapterRevision(bookId: string, chapter: Chapter, paragraphs: string[]): void {
  const editor = liveEditor(chapter.id)
  const current = editor ? editor.getJSON() : chapter.content
  const doc = buildChapterDoc(paragraphs, listIllustrations(current), { keepPlacement: true })
  if (editor) editor.commands.setContent(doc, { emitUpdate: true })
  else setChapterContent(bookId, chapter.id, doc, true)
}
