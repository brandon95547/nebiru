import { del, entries, set as idbSet } from 'idb-keyval'
import { api } from '@/services/api'
import type { Book } from '@/types'

/**
 * Where books are kept.
 *
 * With the Nebiru server running, books live on the server (one file each in
 * its data folder), so they survive a cleared browser and show up from any
 * browser. Without it they live in this browser's IndexedDB.
 *
 * In server mode the browser is still used as a safety net: a book whose save
 * did not reach the server is kept here, and handed over the next time the
 * app starts.
 */

const KEY_PREFIX = 'book:'

export type StorageMode = 'server' | 'browser'

let mode: StorageMode = 'browser'

async function browserBooks(): Promise<Book[]> {
  const books: Book[] = []
  try {
    for (const [key, value] of await entries<IDBValidKey, Book>()) {
      if (typeof key === 'string' && key.startsWith(KEY_PREFIX)) books.push(value)
    }
  } catch (error) {
    console.error('Could not read books saved in this browser', error)
  }
  return books
}

/** Keep a copy of a book in this browser. */
export function keepInBrowser(book: Book): Promise<void> {
  return idbSet(KEY_PREFIX + book.id, book).catch((error) => {
    console.error('Could not save the book in this browser', error)
  })
}

function dropFromBrowser(id: string): Promise<void> {
  return del(KEY_PREFIX + id).catch(() => {})
}

export async function loadBooks(): Promise<{ books: Book[]; mode: StorageMode }> {
  const local = await browserBooks()
  let remote: Book[]
  try {
    remote = (await api.get<{ books: Book[] }>('/books')).books
  } catch {
    mode = 'browser'
    return { books: local, mode }
  }

  mode = 'server'
  const books = new Map(remote.map((book) => [book.id, book]))
  for (const book of local) {
    const known = books.get(book.id)
    if (known && known.updatedAt >= book.updatedAt) {
      // The server already has this version or a newer one.
      await dropFromBrowser(book.id)
      continue
    }
    // Work the server has not seen: made before it was running, or a save that failed.
    books.set(book.id, book)
    try {
      await api.put(`/books/${book.id}`, book)
      await dropFromBrowser(book.id)
    } catch {
      // Still not reachable for this book; the browser copy stays for next time.
    }
  }
  return { books: [...books.values()], mode }
}

/** Save a book. Returns false when it could not reach the server and was kept in the browser instead. */
export async function saveBook(book: Book): Promise<boolean> {
  if (mode === 'browser') {
    await keepInBrowser(book)
    return true
  }
  try {
    await api.put(`/books/${book.id}`, book)
    return true
  } catch {
    await keepInBrowser(book)
    return false
  }
}

export async function deleteBook(id: string): Promise<void> {
  await dropFromBrowser(id)
  if (mode === 'server') await api.delete(`/books/${id}`).catch(() => {})
}
