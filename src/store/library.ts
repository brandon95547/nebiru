import type { JSONContent } from '@tiptap/core'
import { create } from 'zustand'
import { DEFAULT_PAGE } from '@/lib/bookFormats'
import { mapIllustrations, patchIllustration } from '@/lib/doc'
import { uid } from '@/lib/util'
import type { Book, BookOrigin, Chapter, IllustrationAttrs, SourceDocument } from '@/types'
import { deleteBook, keepInBrowser, loadBooks, saveBook, type StorageMode } from './persistence'

/** The library: every book project, held in memory and saved as it changes. */

const SAVE_DELAY_MS = 400

interface LibraryState {
  ready: boolean
  books: Record<string, Book>
  /** Where books are kept: on the Nebiru server, or in this browser when there is no server. */
  storage: StorageMode
  /** True while the latest changes have not reached the server (they are safe in this browser). */
  unsaved: boolean
}

export const useLibrary = create<LibraryState>()(() => ({ ready: false, books: {}, storage: 'browser', unsaved: false }))

const saveTimers = new Map<string, number>()
/** Books with a save on its way, and those that changed again while it was. */
const saving = new Set<string>()
const changedMeanwhile = new Set<string>()
const failed = new Set<string>()

/** Save one book. Saves for the same book never overlap, so an older one cannot land last. */
async function persist(id: string): Promise<void> {
  saveTimers.delete(id)
  if (saving.has(id)) {
    changedMeanwhile.add(id)
    return
  }
  const book = useLibrary.getState().books[id]
  if (!book) return

  saving.add(id)
  const reached = await saveBook(book)
  saving.delete(id)
  if (reached) failed.delete(id)
  else failed.add(id)
  useLibrary.setState({ unsaved: failed.size > 0 })

  if (changedMeanwhile.delete(id)) void persist(id)
  else if (!reached) scheduleRetry()
}

const RETRY_DELAY_MS = 15_000
let retryTimer: number | undefined

/** Keep trying in the background until the server has everything. */
function scheduleRetry(): void {
  if (retryTimer !== undefined) return
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined
    retrySaves()
  }, RETRY_DELAY_MS)
}

function schedulePersist(id: string): void {
  window.clearTimeout(saveTimers.get(id))
  saveTimers.set(id, window.setTimeout(() => void persist(id), SAVE_DELAY_MS))
}

/**
 * Write pending saves immediately (page hide, tab close). A request made as the
 * page goes away may not finish, so each book is also kept in the browser; the
 * next start hands over anything the server did not get.
 */
export function flushSaves(): void {
  const { books, storage } = useLibrary.getState()
  for (const [id, timer] of saveTimers) {
    window.clearTimeout(timer)
    if (storage === 'server' && books[id]) void keepInBrowser(books[id])
    void persist(id)
  }
}

/** Try again to save everything that has not reached the server. */
export function retrySaves(): void {
  for (const id of failed) void persist(id)
}

/**
 * A reload abandons whatever was in flight, so clear the transient
 * "working" states that would otherwise spin forever.
 */
function settle(book: Book): Book {
  const chapters = book.chapters.map((chapter): Chapter => {
    const status = chapter.status === 'writing' ? (chapter.content ? 'ready' : 'planned') : chapter.status
    const content =
      chapter.content &&
      mapIllustrations(chapter.content, (attrs) =>
        attrs.status === 'generating' ? { ...attrs, status: attrs.src ? 'ready' : 'empty' } : attrs,
      )
    return { ...chapter, status, content }
  })
  const cover =
    book.cover.status === 'generating'
      ? { ...book.cover, status: book.cover.src ? ('ready' as const) : ('empty' as const) }
      : book.cover
  const status =
    book.status === 'generating'
      ? chapters.every((c) => c.status === 'ready') && chapters.length > 0
        ? 'ready'
        : 'planning'
      : book.status
  return { ...book, chapters, cover, status }
}

export async function initLibrary(): Promise<void> {
  const loaded = await loadBooks()
  const books: Record<string, Book> = {}
  for (const book of loaded.books) books[book.id] = settle(book)
  useLibrary.setState({ books, storage: loaded.mode, ready: true })
}

export function getBook(id: string): Book | undefined {
  return useLibrary.getState().books[id]
}

export function updateBook(id: string, recipe: (book: Book) => Book): void {
  const current = getBook(id)
  if (!current) return
  const next = { ...recipe(current), updatedAt: Date.now() }
  useLibrary.setState((state) => ({ books: { ...state.books, [id]: next } }))
  schedulePersist(id)
}

export function patchBook(id: string, patch: Partial<Book>): void {
  updateBook(id, (book) => ({ ...book, ...patch }))
}

export interface NewBookInput {
  title: string
  author: string
  description: string
  origin: BookOrigin
  sources: SourceDocument[]
  chapters: Array<Pick<Chapter, 'title' | 'summary' | 'sourceSectionIds'>>
}

export function newChapter(partial: Partial<Chapter> = {}): Chapter {
  return {
    id: uid('ch'),
    title: '',
    summary: '',
    status: 'planned',
    content: null,
    rev: 0,
    sourceSectionIds: [],
    ...partial,
  }
}

export function createBook(input: NewBookInput): Book {
  const now = Date.now()
  const book: Book = {
    id: uid('book'),
    title: input.title,
    author: input.author,
    description: input.description,
    origin: input.origin,
    sources: input.sources,
    status: 'planning',
    chapters: input.chapters.map((chapter) => newChapter(chapter)),
    interiorStyle: 'watercolor',
    coverStyle: 'classical',
    cover: { src: '', prompt: '', status: 'empty', seed: null },
    page: DEFAULT_PAGE,
    chat: [],
    createdAt: now,
    updatedAt: now,
  }
  addBook(book)
  return book
}

export function addBook(book: Book): void {
  useLibrary.setState((state) => ({ books: { ...state.books, [book.id]: book } }))
  schedulePersist(book.id)
}

export function removeBook(id: string): void {
  window.clearTimeout(saveTimers.get(id))
  saveTimers.delete(id)
  useLibrary.setState((state) => {
    const books = { ...state.books }
    delete books[id]
    return { books }
  })
  failed.delete(id)
  void deleteBook(id)
}

export function patchChapter(bookId: string, chapterId: string, patch: Partial<Chapter>): void {
  updateBook(bookId, (book) => ({
    ...book,
    chapters: book.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch } : c)),
  }))
}

/**
 * Store new chapter content. `external` marks a replacement that did not
 * come from the chapter's own editor, which tells a mounted editor to reload.
 */
export function setChapterContent(
  bookId: string,
  chapterId: string,
  content: JSONContent,
  external: boolean,
): void {
  updateBook(bookId, (book) => ({
    ...book,
    chapters: book.chapters.map((c) =>
      c.id === chapterId ? { ...c, content, rev: external ? c.rev + 1 : c.rev } : c,
    ),
  }))
}

export function patchStoredIllustration(
  bookId: string,
  chapterId: string,
  illustrationId: string,
  patch: Partial<IllustrationAttrs>,
): void {
  const chapter = getBook(bookId)?.chapters.find((c) => c.id === chapterId)
  if (!chapter?.content) return
  setChapterContent(bookId, chapterId, patchIllustration(chapter.content, illustrationId, patch), true)
}

export function insertChapter(bookId: string, index: number, chapter: Chapter): void {
  updateBook(bookId, (book) => {
    const chapters = [...book.chapters]
    chapters.splice(index, 0, chapter)
    return { ...book, chapters }
  })
}

export function removeChapter(bookId: string, chapterId: string): void {
  updateBook(bookId, (book) => ({ ...book, chapters: book.chapters.filter((c) => c.id !== chapterId) }))
}

export function moveChapter(bookId: string, chapterId: string, delta: number): void {
  updateBook(bookId, (book) => {
    const from = book.chapters.findIndex((c) => c.id === chapterId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= book.chapters.length) return book
    const chapters = [...book.chapters]
    const [moved] = chapters.splice(from, 1)
    chapters.splice(to, 0, moved)
    return { ...book, chapters }
  })
}

/** Guard for project files opened from disk. */
export function isBook(value: unknown): value is Book {
  if (!value || typeof value !== 'object') return false
  const book = value as Partial<Book>
  return (
    typeof book.id === 'string' &&
    typeof book.title === 'string' &&
    Array.isArray(book.chapters) &&
    typeof book.page === 'object' &&
    book.page !== null
  )
}
