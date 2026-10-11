import { BookOpen, Download, Ellipsis, FileUp, FolderOpen, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AppHeader } from '@/components/AppHeader'
import { BookCover } from '@/components/BookCover'
import { Button } from '@/components/ui/Button'
import { Menu, Modal } from '@/components/ui/Overlay'
import { docWordCount } from '@/lib/doc'
import { downloadFile, plural, slugify, timeAgo, uid } from '@/lib/util'
import { addBook, isBook, removeBook, useLibrary } from '@/store/library'
import type { Book } from '@/types'

const STATUS_LABEL: Record<Book['status'], string> = {
  planning: 'Planning',
  generating: 'Writing',
  ready: 'Draft',
}

function bookHref(book: Book): string {
  return book.status === 'ready' ? `/book/${book.id}` : `/book/${book.id}/plan`
}

function downloadProject(book: Book): void {
  downloadFile(`${slugify(book.title)}.nebiru.json`, JSON.stringify(book), 'application/json')
}

function BookCard({ book, onDelete }: { book: Book; onDelete: () => void }) {
  const words = useMemo(
    () => book.chapters.reduce((sum, chapter) => sum + docWordCount(chapter.content), 0),
    [book.chapters],
  )
  return (
    <article className="group">
      {/* The title below is the real link; this one only makes the cover clickable. */}
      <Link to={bookHref(book)} aria-hidden tabIndex={-1} className="block">
        <BookCover
          book={book}
          className="rounded-md shadow-lg shadow-black/50 ring-1 ring-line-strong transition-transform group-hover:-translate-y-1"
        />
      </Link>
      <div className="mt-3 flex items-start gap-1">
        <Link to={bookHref(book)} className="min-w-0 flex-1 rounded">
          <h2 className="line-clamp-2 font-medium text-ink">{book.title || 'Untitled'}</h2>
          <p className="mt-1 text-sm text-ink-mute">
            {STATUS_LABEL[book.status]} · {plural(book.chapters.length, 'chapter')}
            {words > 0 && ` · ${plural(words, 'word')}`}
          </p>
          <p className="text-sm text-ink-mute">Edited {timeAgo(book.updatedAt)}</p>
        </Link>
        <Menu
          label={`Actions for ${book.title || 'Untitled'}`}
          trigger={<Ellipsis className="size-4" />}
          items={[
            { label: 'Download project file', icon: <Download className="size-4" />, onSelect: () => downloadProject(book) },
            { label: 'Delete book', icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
    </article>
  )
}

function EmptyLibrary() {
  return (
    <div className="mx-auto max-w-2xl py-20 text-center">
      <BookOpen aria-hidden className="mx-auto size-10 text-accent" />
      <h1 className="mt-6 font-display text-4xl text-ink">Make your first book</h1>
      <p className="mt-4 text-lg text-ink-soft">
        Start from an idea, or bring in a manuscript, an ebook or a recording. Nebiru plans the chapters,
        writes and illustrates them, and lays out every page for you to edit.
      </p>
      <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
        <Link
          to="/new?mode=idea"
          className="rounded-xl border border-line-strong bg-panel p-6 transition-colors hover:border-accent"
        >
          <Sparkles aria-hidden className="size-6 text-accent" />
          <h2 className="mt-4 text-lg font-medium text-ink">Start from an idea</h2>
          <p className="mt-1 text-ink-soft">Describe the book you want and get a title and chapter plan.</p>
        </Link>
        <Link
          to="/new?mode=import"
          className="rounded-xl border border-line-strong bg-panel p-6 transition-colors hover:border-accent"
        >
          <FileUp aria-hidden className="size-6 text-accent" />
          <h2 className="mt-4 text-lg font-medium text-ink">Import material</h2>
          <p className="mt-1 text-ink-soft">EPUB, PDF, Word, text and HTML files, read right in your browser.</p>
        </Link>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const books = useLibrary((state) => state.books)
  const list = useMemo(() => Object.values(books).sort((a, b) => b.updatedAt - a.updatedAt), [books])
  const [deleting, setDeleting] = useState<Book | null>(null)
  const [fileError, setFileError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const openProject = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isBook(parsed)) throw new Error('not a project')
      // A fresh id keeps an opened copy from overwriting a book already in the library.
      const book: Book = { ...parsed, id: uid('book'), updatedAt: Date.now() }
      addBook(book)
      navigate(bookHref(book))
    } catch {
      setFileError(`“${file.name}” is not a Nebiru project file.`)
    }
  }

  return (
    <div className="min-h-full">
      <AppHeader>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            void openProject(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
          <FolderOpen className="size-4" />
          Open project file
        </Button>
        <Button onClick={() => navigate('/new')}>
          <Plus className="size-4" />
          New book
        </Button>
      </AppHeader>

      <main className="mx-auto max-w-7xl px-6 py-10">
        {fileError && (
          <p role="alert" className="mb-6 rounded-md border border-red-400/40 bg-red-950 px-4 py-3 text-red-200">
            {fileError}
          </p>
        )}
        {list.length === 0 ? (
          <EmptyLibrary />
        ) : (
          <>
            <div className="mb-8">
              <h1 className="font-display text-3xl text-ink">Library</h1>
              <p className="mt-1 text-ink-mute">{plural(list.length, 'book')}</p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-10">
              {list.map((book) => (
                <BookCard key={book.id} book={book} onDelete={() => setDeleting(book)} />
              ))}
            </div>
          </>
        )}
      </main>

      {deleting && (
        <Modal
          title="Delete this book?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeBook(deleting.id)
                  setDeleting(null)
                }}
              >
                Delete book
              </Button>
            </>
          }
        >
          <p className="text-ink-soft">
            “{deleting.title || 'Untitled'}” and everything in it will be removed from this browser. Download
            the project file first if you want a copy.
          </p>
        </Modal>
      )}
    </div>
  )
}
