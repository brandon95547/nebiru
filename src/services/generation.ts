import { create } from 'zustand'
import { isContentsTitle } from '@/lib/chapters'
import { buildChapterDoc, listIllustrations, newIllustration } from '@/lib/doc'
import { findIllustration, liveEditor, patchLiveIllustration } from '@/store/editorHub'
import { getBook, patchBook, patchChapter, patchStoredIllustration, updateBook } from '@/store/library'
import type { Book, Chapter, IllustrationAttrs } from '@/types'
import { services } from './index'
import type { BookBrief } from './text/types'

/**
 * Orchestrates writing and illustrating a book. Jobs run outside React so
 * they keep going while the user moves between screens.
 */

interface JobsState {
  /** Books with a full generation run in progress. */
  books: Record<string, boolean>
  /** Why the last attempt at a picture failed, keyed by illustration id (or book id for a cover). */
  pictureErrors: Record<string, string>
}

export const useJobs = create<JobsState>()(() => ({ books: {}, pictureErrors: {} }))

function setPictureError(key: string, message: string | null): void {
  useJobs.setState((state) => {
    const pictureErrors = { ...state.pictureErrors }
    if (message) pictureErrors[key] = message
    else delete pictureErrors[key]
    return { pictureErrors }
  })
}

function setRunning(bookId: string, running: boolean): void {
  useJobs.setState((state) => ({ books: { ...state.books, [bookId]: running } }))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function briefOf(book: Book): BookBrief {
  return {
    title: book.title,
    author: book.author,
    description: book.description,
    origin: book.origin,
    chapters: book.chapters.map(({ id, title, summary }) => ({ id, title, summary })),
  }
}

function sourceParagraphs(book: Book, chapter: Chapter): string[] {
  if (chapter.sourceSectionIds.length === 0) return []
  const wanted = new Set(chapter.sourceSectionIds)
  return book.sources.flatMap((source) =>
    source.sections.filter((section) => wanted.has(section.id)).flatMap((section) => section.paragraphs),
  )
}

/** An illustration's current attributes, from its editor when one is open. */
function readIllustration(bookId: string, chapterId: string, id: string): IllustrationAttrs | null {
  const editor = liveEditor(chapterId)
  if (editor) return findIllustration(editor, id)?.attrs ?? null
  const chapter = getBook(bookId)?.chapters.find((c) => c.id === chapterId)
  return listIllustrations(chapter?.content ?? null).find((attrs) => attrs.id === id) ?? null
}

function writeIllustration(
  bookId: string,
  chapterId: string,
  id: string,
  patch: Partial<IllustrationAttrs>,
): void {
  const editor = liveEditor(chapterId)
  if (editor && patchLiveIllustration(editor, id, patch, { history: false })) return
  patchStoredIllustration(bookId, chapterId, id, patch)
}

export async function generateIllustration(bookId: string, chapterId: string, id: string): Promise<void> {
  const book = getBook(bookId)
  const attrs = readIllustration(bookId, chapterId, id)
  if (!book || !attrs) return

  writeIllustration(bookId, chapterId, id, { status: 'generating' })
  setPictureError(id, null)
  try {
    const result = await services.illustration.generate({
      prompt: attrs.prompt,
      styleId: book.interiorStyle,
      aspect: attrs.aspect,
      purpose: 'interior',
    })
    writeIllustration(bookId, chapterId, id, { src: result.src, seed: result.seed, status: 'ready' })
  } catch (error) {
    setPictureError(id, errorMessage(error))
    writeIllustration(bookId, chapterId, id, { status: 'error' })
  }
}

export async function generateCover(bookId: string): Promise<void> {
  const book = getBook(bookId)
  if (!book) return
  const prompt = book.cover.prompt || `Front cover for “${book.title}”. ${book.description}`.slice(0, 400)
  patchBook(bookId, { cover: { ...book.cover, prompt, status: 'generating' } })
  setPictureError(bookId, null)
  try {
    const result = await services.illustration.generate({
      prompt,
      styleId: book.coverStyle,
      aspect: book.page.widthIn / book.page.heightIn,
      purpose: 'cover',
    })
    patchBook(bookId, { cover: { prompt, src: result.src, seed: result.seed, status: 'ready' } })
  } catch (error) {
    setPictureError(bookId, errorMessage(error))
    updateBook(bookId, (current) => ({ ...current, cover: { ...current.cover, status: 'error' } }))
  }
}

/** Write (or rewrite) one chapter and illustrate it. Other chapters are untouched. */
export async function writeChapter(bookId: string, chapterId: string, instruction?: string): Promise<void> {
  const book = getBook(bookId)
  const chapterIndex = book?.chapters.findIndex((c) => c.id === chapterId) ?? -1
  if (!book || chapterIndex < 0) return
  const chapter = book.chapters[chapterIndex]

  patchChapter(bookId, chapterId, { status: 'writing', error: undefined })
  try {
    const draft = await services.text.writeChapter({
      brief: briefOf(book),
      chapterIndex,
      sourceParagraphs: sourceParagraphs(book, chapter),
      instruction,
    })
    // A table of contents is a list, not prose to wrap around a picture: its
    // illustration sits above it, wide and centred.
    const lead = isContentsTitle(chapter.title)
    const illustrations = draft.illustrationPrompts.map((prompt, i) =>
      newIllustration(lead && i === 0 ? { prompt, aspect: 3 / 2, widthPct: 72 } : { prompt }),
    )
    const content = buildChapterDoc(draft.paragraphs, illustrations, { lead })
    updateBook(bookId, (current) => ({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === chapterId ? { ...c, content, rev: c.rev + 1, status: 'ready', error: draft.note } : c,
      ),
    }))
    for (const illustration of illustrations) {
      await generateIllustration(bookId, chapterId, illustration.id)
    }
  } catch (error) {
    patchChapter(bookId, chapterId, { status: 'error', error: errorMessage(error) })
  }
}

/** Write every chapter that is not written yet, then the cover. */
export async function generateBook(bookId: string): Promise<void> {
  if (useJobs.getState().books[bookId]) return
  setRunning(bookId, true)
  patchBook(bookId, { status: 'generating' })
  try {
    for (const { id } of getBook(bookId)?.chapters ?? []) {
      const chapter = getBook(bookId)?.chapters.find((c) => c.id === id)
      if (chapter && chapter.status !== 'ready') await writeChapter(bookId, id)
    }
    const book = getBook(bookId)
    if (book && !book.cover.src) await generateCover(bookId)
  } finally {
    const book = getBook(bookId)
    if (book) {
      const done = book.chapters.length > 0 && book.chapters.every((c) => c.status === 'ready')
      patchBook(bookId, { status: done ? 'ready' : 'planning' })
    }
    setRunning(bookId, false)
  }
}

/** Redraw every interior illustration in the book's current style. */
export async function restyleInterior(bookId: string): Promise<void> {
  for (const chapter of getBook(bookId)?.chapters ?? []) {
    const editor = liveEditor(chapter.id)
    const ids = editor
      ? listIllustrations(editor.getJSON()).map((attrs) => attrs.id)
      : listIllustrations(chapter.content).map((attrs) => attrs.id)
    for (const id of ids) await generateIllustration(bookId, chapter.id, id)
  }
}
