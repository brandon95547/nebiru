import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { EMPTY_DOC } from '@/lib/doc'
import { bumpTick, noteSelection, registerEditor, unregisterEditor } from '@/store/editorHub'
import { setChapterContent } from '@/store/library'
import type { Chapter } from '@/types'
import { bookExtensions } from './extensions'
import { useRemeasure } from './flow'

const SAVE_DELAY_MS = 250

/** The live, editable body of one chapter. */
export function ChapterEditor({ bookId, chapter }: { bookId: string; chapter: Chapter }) {
  const chapterId = chapter.id
  const latestRemeasure = useRemeasure()
  const remeasure = useRef(latestRemeasure)
  const saveTimer = useRef<number | undefined>(undefined)
  const loadedRev = useRef(chapter.rev)

  // The editor's callbacks are created once, so they reach the current measurer through a ref.
  useEffect(() => {
    remeasure.current = latestRemeasure
  }, [latestRemeasure])

  const editor = useEditor(
    {
      extensions: bookExtensions,
      content: chapter.content ?? EMPTY_DOC,
      editorProps: { attributes: { spellcheck: 'true' } },
      onUpdate: ({ editor }) => {
        // Typing can push text onto a new page straight away; saving can wait a beat.
        remeasure.current()
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = undefined
          setChapterContent(bookId, chapterId, editor.getJSON(), false)
        }, SAVE_DELAY_MS)
      },
      onTransaction: ({ editor }) => {
        if (editor.isFocused) noteSelection(chapterId, editor)
        else bumpTick()
      },
      onFocus: ({ editor }) => noteSelection(chapterId, editor),
    },
    [bookId, chapterId],
  )

  useEffect(() => {
    if (!editor) return
    registerEditor(chapterId, editor)
    return () => {
      unregisterEditor(chapterId, editor)
      // Keep edits made in the last moments before the editor went away.
      if (saveTimer.current !== undefined) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = undefined
        try {
          setChapterContent(bookId, chapterId, editor.getJSON(), false)
        } catch {
          // The editor was already torn down; the previous save stands.
        }
      }
    }
  }, [editor, bookId, chapterId])

  // Content replaced from outside (a regenerated chapter, a background job): reload it.
  useEffect(() => {
    if (!editor || chapter.rev === loadedRev.current) return
    loadedRev.current = chapter.rev
    window.clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    editor.commands.setContent(chapter.content ?? EMPTY_DOC, { emitUpdate: false })
    remeasure.current()
  }, [editor, chapter.rev, chapter.content])

  return <EditorContent editor={editor} />
}
