import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { create } from 'zustand'
import type { IllustrationAttrs } from '@/types'

/**
 * Live chapter editors, keyed by chapter id. Toolbars, the inspector and
 * background jobs reach a chapter's editor through here instead of holding
 * their own references.
 */

interface EditorHubState {
  editors: Record<string, Editor>
  activeChapterId: string | null
  selectedIllustration: { chapterId: string; id: string } | null
  /** Bumped on every editor transaction so dependent UI re-reads editor state. */
  tick: number
}

export const useEditorHub = create<EditorHubState>()(() => ({
  editors: {},
  activeChapterId: null,
  selectedIllustration: null,
  tick: 0,
}))

export function registerEditor(chapterId: string, editor: Editor): void {
  useEditorHub.setState((state) => ({ editors: { ...state.editors, [chapterId]: editor } }))
}

export function unregisterEditor(chapterId: string, editor: Editor): void {
  useEditorHub.setState((state) => {
    if (state.editors[chapterId] !== editor) return state
    const editors = { ...state.editors }
    delete editors[chapterId]
    return {
      editors,
      activeChapterId: state.activeChapterId === chapterId ? null : state.activeChapterId,
      selectedIllustration:
        state.selectedIllustration?.chapterId === chapterId ? null : state.selectedIllustration,
    }
  })
}

export function liveEditor(chapterId: string): Editor | null {
  const editor = useEditorHub.getState().editors[chapterId]
  return editor && !editor.isDestroyed ? editor : null
}

export function activeEditor(): Editor | null {
  const { activeChapterId } = useEditorHub.getState()
  return activeChapterId ? liveEditor(activeChapterId) : null
}

/** Record which chapter has focus and whether an illustration is selected in it. */
export function noteSelection(chapterId: string, editor: Editor): void {
  const { selection } = editor.state
  const node = selection instanceof NodeSelection ? selection.node : null
  const selected = node?.type.name === 'illustration' ? { chapterId, id: node.attrs.id as string } : null
  useEditorHub.setState((state) => ({
    activeChapterId: chapterId,
    selectedIllustration: selected,
    tick: state.tick + 1,
  }))
}

export function bumpTick(): void {
  useEditorHub.setState((state) => ({ tick: state.tick + 1 }))
}

export function findIllustration(
  editor: Editor,
  id: string,
): { pos: number; attrs: IllustrationAttrs } | null {
  let found: { pos: number; attrs: IllustrationAttrs } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'illustration' && node.attrs.id === id) {
      found = { pos, attrs: node.attrs as IllustrationAttrs }
      return false
    }
    return true
  })
  return found
}

/** Patch an illustration through its editor. Returns false if it is not in the document. */
export function patchLiveIllustration(
  editor: Editor,
  id: string,
  patch: Partial<IllustrationAttrs>,
  options: { history?: boolean } = {},
): boolean {
  const target = findIllustration(editor, id)
  if (!target) return false
  const tr = editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, ...patch })
  if (options.history === false) tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
  return true
}
