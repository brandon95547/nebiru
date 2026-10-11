import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, CircleAlert, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { AppHeader } from '@/components/AppHeader'
import { StylePicker } from '@/components/StylePicker'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Segmented, Textarea } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Overlay'
import { cx, plural } from '@/lib/util'
import { services } from '@/services'
import { briefOf, generateBook, useJobs } from '@/services/generation'
import type { PlannedChapter } from '@/services/text/types'
import {
  insertChapter,
  moveChapter,
  newChapter,
  patchBook,
  patchChapter,
  removeChapter,
  updateBook,
  useLibrary,
} from '@/store/library'
import type { Book, Chapter } from '@/types'

/** Replace the table of contents with a revised one, keeping chapters that carry over. */
function applyOutline(bookId: string, planned: PlannedChapter[]): void {
  updateBook(bookId, (book) => {
    const existing = new Map(book.chapters.map((chapter) => [chapter.id, chapter]))
    const chapters = planned.map((entry) => {
      const kept = entry.id ? existing.get(entry.id) : undefined
      return kept
        ? { ...kept, title: entry.title, summary: entry.summary }
        : newChapter({ title: entry.title, summary: entry.summary, sourceSectionIds: entry.sourceSectionIds ?? [] })
    })
    return { ...book, chapters }
  })
}

function ChapterState({ chapter }: { chapter: Chapter }) {
  if (chapter.status === 'writing') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-accent-soft">
        <Spinner className="size-3.5" /> Writing…
      </span>
    )
  }
  if (chapter.status === 'ready') {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 text-success">
          <Check aria-hidden className="size-3.5" /> Written
        </span>
        {chapter.error && <span className="text-accent-soft">{chapter.error}</span>}
      </span>
    )
  }
  if (chapter.status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-red-300">
        <CircleAlert aria-hidden className="size-3.5" /> {chapter.error ?? 'Could not be written'}
      </span>
    )
  }
  return null
}

function TocRow({ book, chapter, index, locked }: { book: Book; chapter: Chapter; index: number; locked: boolean }) {
  const number = index + 1
  // A single page is one entry: there is nothing to reorder or remove.
  const single = book.kind === 'page'
  return (
    <li className="flex gap-3 px-5 py-4">
      <span className="w-6 shrink-0 pt-2 text-right text-ink-mute tabular-nums">{number}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <Input
          aria-label={`Chapter ${number} title`}
          placeholder="Chapter title"
          value={chapter.title}
          disabled={locked}
          onChange={(event) => patchChapter(book.id, chapter.id, { title: event.target.value })}
          className="font-medium"
        />
        <Textarea
          aria-label={`Chapter ${number} summary`}
          placeholder="What this chapter covers"
          rows={2}
          value={chapter.summary}
          disabled={locked}
          onChange={(event) => patchChapter(book.id, chapter.id, { summary: event.target.value })}
          className="field-sizing-content text-sm text-ink-soft"
        />
        <ChapterState chapter={chapter} />
      </div>
      {!single && (
      <div className="flex shrink-0 flex-col">
        <IconButton label={`Move chapter ${number} up`} disabled={locked || index === 0} onClick={() => moveChapter(book.id, chapter.id, -1)}>
          <ArrowUp className="size-4" />
        </IconButton>
        <IconButton
          label={`Move chapter ${number} down`}
          disabled={locked || index === book.chapters.length - 1}
          onClick={() => moveChapter(book.id, chapter.id, 1)}
        >
          <ArrowDown className="size-4" />
        </IconButton>
        <IconButton label={`Remove chapter ${number}`} disabled={locked} onClick={() => removeChapter(book.id, chapter.id)}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      )}
    </li>
  )
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

function OutlineAssistant({ book, locked }: { book: Book; locked: boolean }) {
  const [instruction, setInstruction] = useState('')
  const [thread, setThread] = useState<Turn[]>([])
  const [working, setWorking] = useState(false)

  const send = async () => {
    const text = instruction.trim()
    if (!text || working) return
    setInstruction('')
    setThread((turns) => [...turns, { role: 'user', text }])
    setWorking(true)
    try {
      const result = await services.text.reviseOutline({ brief: briefOf(book), instruction: text })
      if (result.chapters) applyOutline(book.id, result.chapters)
      setThread((turns) => [...turns, { role: 'assistant', text: result.reply }])
    } catch (error) {
      const reply = error instanceof Error ? error.message : 'That did not work. Try again.'
      setThread((turns) => [...turns, { role: 'assistant', text: reply }])
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="flex items-center gap-2 font-medium text-ink">
        <Sparkles aria-hidden className="size-4 text-accent" /> Refine with the assistant
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Describe a change and the table of contents is reworked to match.
      </p>
      {thread.length > 0 && (
        <ul className="scroll-quiet mt-4 max-h-64 space-y-2 overflow-y-auto">
          {thread.map((turn, i) => (
            <li
              key={i}
              className={cx(
                'rounded-lg px-3 py-2 text-sm',
                turn.role === 'user' ? 'ml-6 bg-raised text-ink' : 'mr-6 border border-line text-ink-soft',
              )}
            >
              {turn.text}
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <Textarea
          aria-label="Instruction for the assistant"
          rows={3}
          value={instruction}
          disabled={locked}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Merge the first two chapters and add one on the history…"
          className="text-sm"
        />
        <Button type="submit" variant="secondary" size="sm" className="mt-2 w-full" disabled={locked || working || !instruction.trim()}>
          {working ? <Spinner /> : <Send className="size-4" />}
          Apply to the table of contents
        </Button>
      </form>
    </section>
  )
}

function sourceLine(book: Book): string {
  if (book.origin.kind === 'concept') return 'Written from your concept.'
  return book.origin.mode === 'preserve'
    ? 'Keeps the imported text exactly as written.'
    : 'Says what the imported text says, rewritten in new words throughout.'
}

export function PlanPage() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  const book = useLibrary((state) => state.books[bookId])
  const running = useJobs((state) => Boolean(state.books[bookId]))
  const startedHere = useRef(false)
  const status = book?.status

  // Once a run started from this screen finishes, move on to the editor.
  useEffect(() => {
    if (startedHere.current && !running && status === 'ready') navigate(`/book/${bookId}`)
  }, [running, status, bookId, navigate])

  if (!book) return <Navigate to="/" replace />

  const isPage = book.kind === 'page'
  const total = book.chapters.length
  const written = book.chapters.filter((chapter) => chapter.status === 'ready').length
  const remaining = total - written

  const start = () => {
    startedHere.current = true
    void generateBook(book.id)
  }

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-2 rounded text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" /> Library
        </Link>
        <h1 className="mt-4 font-display text-4xl text-ink">{isPage ? 'Your page' : 'Approve the table of contents'}</h1>
        <p className="mt-2 text-lg text-ink-soft">
          {isPage
            ? 'Check the title and the look, then make the page.'
            : 'Nothing is written until you approve it. Change anything here first: retitle, reorder, add or remove chapters.'}
        </p>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
              <Field label="Title">
                <Input
                  value={book.title}
                  onChange={(event) => patchBook(book.id, { title: event.target.value })}
                  className="h-12 font-display text-xl"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Field label="Description">
                  <Textarea
                    rows={3}
                    value={book.description}
                    onChange={(event) => patchBook(book.id, { description: event.target.value })}
                    className="field-sizing-content"
                  />
                </Field>
                <Field label="Author">
                  <Input value={book.author} onChange={(event) => patchBook(book.id, { author: event.target.value })} />
                </Field>
              </div>
            </section>

            <section className="rounded-xl border border-line bg-panel">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <div>
                  <h2 className="font-medium text-ink">{isPage ? 'The page' : 'Table of contents'}</h2>
                  {!isPage && <p className="text-sm text-ink-mute">{plural(total, 'chapter')}</p>}
                </div>
                {!isPage && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={running}
                    onClick={() => insertChapter(book.id, total, newChapter())}
                  >
                    <Plus className="size-4" /> Add chapter
                  </Button>
                )}
              </div>
              {total === 0 ? (
                <p className="px-5 py-8 text-center text-ink-soft">No chapters yet. Add one to begin.</p>
              ) : (
                <ol className="divide-y divide-line">
                  {book.chapters.map((chapter, index) => (
                    <TocRow key={chapter.id} book={book} chapter={chapter} index={index} locked={running} />
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-xl border border-line bg-panel p-5">
              <h2 className="font-medium text-ink">The look</h2>
              <div className="mt-4 max-w-sm">
                <Field
                  label={isPage ? 'Page' : 'Pages'}
                  hint={book.page.theme === 'dark' ? 'Dark pages suit the screen. Choose light for printing.' : 'Dark text on light paper, the way a book prints.'}
                >
                  <Segmented
                    label="Page colour"
                    value={book.page.theme}
                    onChange={(theme) => patchBook(book.id, { page: { ...book.page, theme } })}
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                </Field>
              </div>
              <div className={cx('mt-5 grid gap-6', !isPage && 'sm:grid-cols-2')}>
                <div>
                  <h3 className="mb-2 text-sm font-medium text-ink-soft">{isPage ? 'Illustration style' : 'Illustrations inside'}</h3>
                  <StylePicker
                    compact
                    label="Interior illustration style"
                    value={book.interiorStyle}
                    onChange={(interiorStyle) => patchBook(book.id, { interiorStyle })}
                  />
                </div>
                {!isPage && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-ink-soft">Front cover</h3>
                    <StylePicker
                      compact
                      label="Cover illustration style"
                      value={book.coverStyle}
                      onChange={(coverStyle) => patchBook(book.id, { coverStyle })}
                    />
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24">
            <section className="rounded-xl border border-line bg-panel p-5">
              <h2 className="font-medium text-ink">
                {isPage ? (running ? 'Making the page' : 'Make the page') : running ? 'Writing the book' : 'Write the book'}
              </h2>
              <p className="mt-1 text-sm text-ink-soft">{sourceLine(book)}</p>

              {!isPage && (running || written > 0) && total > 0 && (
                <div className="mt-4">
                  <div
                    role="progressbar"
                    aria-label="Chapters written"
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={written}
                    className="h-1.5 overflow-hidden rounded-full bg-raised"
                  >
                    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(written / total) * 100}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">
                    {written} of {plural(total, 'chapter')} written
                  </p>
                </div>
              )}

              {remaining === 0 && total > 0 && !running ? (
                <Button className="mt-5 w-full" onClick={() => navigate(`/book/${book.id}`)}>
                  <BookOpen className="size-4" /> Open the editor
                </Button>
              ) : (
                <Button className="mt-5 w-full" disabled={running || total === 0} onClick={start}>
                  {running ? <Spinner /> : <Sparkles className="size-4" />}
                  {isPage
                    ? running
                      ? 'Making the page…'
                      : 'Make the page'
                    : running
                      ? 'Writing…'
                      : written > 0
                        ? `Write ${plural(remaining, 'remaining chapter')}`
                        : `Approve and write ${plural(total, 'chapter')}`}
                </Button>
              )}
              {written > 0 && remaining > 0 && !running && (
                <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate(`/book/${book.id}`)}>
                  Open the editor with what is written
                </Button>
              )}
            </section>

            {!isPage && <OutlineAssistant book={book} locked={running} />}
          </aside>
        </div>
      </main>
    </div>
  )
}
