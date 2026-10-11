import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CircleAlert,
  CircleCheck,
  Clock,
  Equal,
  File,
  FileText,
  FileUp,
  Moon,
  PenLine,
  Sparkles,
  Sun,
  X,
} from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AppHeader } from '@/components/AppHeader'
import { StylePicker } from '@/components/StylePicker'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { OptionCards } from '@/components/ui/OptionCards'
import { Spinner } from '@/components/ui/Overlay'
import { listIllustrations } from '@/lib/doc'
import { cx, plural, uid } from '@/lib/util'
import { services } from '@/services'
import { generateBook } from '@/services/generation'
import { ACCEPTED_EXTENSIONS, importFile } from '@/services/import'
import { createBook, getBook, useLibrary } from '@/store/library'
import type { BookKind, IllustrationStyleId, ImportMode, PageTheme, SourceDocument } from '@/types'

/**
 * Starting something new, one decision at a time:
 *
 *   an idea:   describe it → choose the look → approve the table of contents
 *   imports:   add files → a page or a book, kept or reworded → choose the look
 *              → (a book) approve the table of contents
 *
 * Nothing is written until the last step, and a book is not written until its
 * table of contents has been approved on the next screen.
 */

type Path = 'idea' | 'import'
type StepId = 'source' | 'make' | 'look'

const STEPS: Record<Path, StepId[]> = { idea: ['source', 'look'], import: ['source', 'make', 'look'] }

const CHAPTER_COUNTS = [5, 8, 10, 12, 15, 20, 25, 30]
/** Imports shorter than this, in at most two sections, are probably one page rather than a book. */
const PAGE_SIZED_WORDS = 1200

interface SourceRow {
  id: string
  name: string
  status: 'reading' | 'parsed' | 'needs-service' | 'error'
  document?: SourceDocument
  reason?: string
}

function stepName(step: StepId, path: Path): string {
  if (step === 'source') return path === 'idea' ? 'Your idea' : 'Your files'
  return step === 'make' ? 'What to make' : 'The look'
}

function SourceStatus({ row }: { row: SourceRow }) {
  if (row.status === 'reading') {
    return (
      <span className="flex items-center gap-2 text-sm text-ink-soft">
        <Spinner /> Reading…
      </span>
    )
  }
  if (row.status === 'parsed' && row.document) {
    return (
      <span className="flex items-center gap-2 text-sm text-ink-soft">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
        {plural(row.document.wordCount, 'word')} · {plural(row.document.sections.length, 'section')}
      </span>
    )
  }
  const waiting = row.status === 'needs-service'
  const Icon = waiting ? Clock : CircleAlert
  return (
    <span className={cx('flex items-start gap-2 text-sm', waiting ? 'text-accent-soft' : 'text-red-300')}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {row.reason}
    </span>
  )
}

/** Everything that was imported, as the single source section a one-page project draws on. */
function asOnePage(sources: SourceDocument[]): { title: string; source: SourceDocument } {
  const sections = sources.flatMap((source) => source.sections)
  const title =
    sections.find((section) => section.title)?.title ?? sources[0].title ?? sources[0].name.replace(/\.[^.]+$/, '')
  // The first heading becomes the page's title; later ones stay on the page as headings.
  const paragraphs = sections.flatMap((section, index) =>
    index > 0 && section.title ? [`## ${section.title}`, ...section.paragraphs] : section.paragraphs,
  )
  return {
    title,
    source: {
      id: uid('src'),
      name: sources.map((source) => source.name).join(', '),
      format: sources[0].format,
      wordCount: sources.reduce((sum, source) => sum + source.wordCount, 0),
      sections: [{ id: uid('sec'), title, paragraphs }],
    },
  }
}

/** What is happening to a single page while it is being made. */
function PageProgress({ bookId, mode }: { bookId: string; mode: ImportMode }) {
  const chapter = useLibrary((state) => state.books[bookId]?.chapters[0])
  const drawing = listIllustrations(chapter?.content ?? null).some((picture) => picture.status === 'generating')
  const doing = drawing
    ? 'Drawing the illustration…'
    : mode === 'reword'
      ? 'Rewriting the text in new words…'
      : 'Setting the text and planning its illustration…'
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-line bg-panel p-6 text-ink">
      <Spinner className="size-5 text-accent" />
      <div>
        <p className="font-medium">Making your page</p>
        <p className="text-sm text-ink-soft">{doing}</p>
      </div>
    </div>
  )
}

export function NewBookPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [path, setPath] = useState<Path>(params.get('mode') === 'import' ? 'import' : 'idea')
  const [stepIndex, setStepIndex] = useState(0)

  const [concept, setConcept] = useState('')
  const [chapterCount, setChapterCount] = useState(10)
  const [rows, setRows] = useState<SourceRow[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const [chosenKind, setChosenKind] = useState<BookKind | null>(null)
  const [textMode, setTextMode] = useState<ImportMode>('preserve')
  const [theme, setTheme] = useState<PageTheme>('light')
  const [interiorStyle, setInteriorStyle] = useState<IllustrationStyleId>('watercolor')
  const [coverStyle, setCoverStyle] = useState<IllustrationStyleId>('classical')
  const [notes, setNotes] = useState('')

  const [busy, setBusy] = useState(false)
  const [makingPage, setMakingPage] = useState<string | null>(null)
  const [error, setError] = useState('')

  const steps = STEPS[path]
  const step = steps[stepIndex]
  const lastStep = stepIndex === steps.length - 1

  const sources = rows.flatMap((row) => (row.document ? [row.document] : []))
  const reading = rows.some((row) => row.status === 'reading')
  const words = sources.reduce((sum, source) => sum + source.wordCount, 0)
  const sectionCount = sources.reduce((sum, source) => sum + source.sections.length, 0)
  // Until the author says otherwise, a short import is taken to be one page.
  const kind: BookKind =
    path === 'idea' ? 'book' : (chosenKind ?? (words <= PAGE_SIZED_WORDS && sectionCount <= 2 ? 'page' : 'book'))

  const sourceReady = path === 'idea' ? concept.trim().length >= 10 : sources.length > 0 && !reading

  const addFiles = (files: FileList | File[]) => {
    // Photographed pages are named in the order they were taken (IMG_6351, IMG_6352, …),
    // so a batch is read in name order whatever order the files were dropped in.
    const batch = Array.from(files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const file of batch) {
      const id = uid('row')
      setRows((current) => [...current, { id, name: file.name, status: 'reading' }])
      void importFile(file).then((outcome) => {
        setRows((current) =>
          current.map((row) =>
            row.id !== id
              ? row
              : outcome.status === 'parsed'
                ? { ...row, status: 'parsed', document: outcome.document }
                : { ...row, status: outcome.status, reason: outcome.reason },
          ),
        )
      })
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const choosePath = (next: Path) => {
    setPath(next)
    setStepIndex(0)
  }

  const finish = async () => {
    setBusy(true)
    setError('')
    const look = { theme, interiorStyle, coverStyle }
    const author = sources.find((source) => source.author)?.author ?? ''
    const instruction = notes.trim() || undefined
    try {
      if (path === 'import' && kind === 'page') {
        // One page needs no table of contents to approve: make it now.
        const { title, source } = asOnePage(sources)
        const book = createBook({
          kind: 'page',
          title,
          author,
          description: '',
          origin: { kind: 'import', mode: textMode, instruction },
          sources: [source],
          chapters: [{ title, summary: '', sourceSectionIds: [source.sections[0].id] }],
          ...look,
        })
        setMakingPage(book.id)
        await generateBook(book.id)
        const made = getBook(book.id)?.chapters[0]?.status === 'ready'
        // If it could not be made, the next screen says why and offers another try.
        navigate(made ? `/book/${book.id}` : `/book/${book.id}/plan`)
        return
      }

      const plan = await services.text.planBook(
        path === 'idea'
          ? { kind: 'concept', concept: concept.trim(), chapterCount }
          : { kind: 'import', mode: textMode, sources, instruction },
      )
      const book = createBook({
        kind: 'book',
        title: plan.title,
        author,
        description: plan.description,
        origin:
          path === 'idea'
            ? { kind: 'concept', concept: concept.trim() }
            : { kind: 'import', mode: textMode, instruction },
        sources: path === 'import' ? sources : [],
        chapters: plan.chapters.map((chapter) => ({
          title: chapter.title,
          summary: chapter.summary,
          sourceSectionIds: chapter.sourceSectionIds ?? [],
        })),
        ...look,
      })
      // The table of contents is approved, or edited, there. Nothing is written before that.
      navigate(`/book/${book.id}/plan`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.')
      setBusy(false)
    }
  }

  const outcome = kind === 'page' ? 'Your page' : 'Approve the contents'

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-2 rounded text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" /> Library
        </Link>
        <h1 className="mt-4 font-display text-4xl text-ink">Start something new</h1>

        <ol aria-label="Steps" className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {steps.map((id, index) => (
            <li key={id} className="flex items-center gap-2">
              <span
                aria-current={index === stepIndex ? 'step' : undefined}
                className={cx(
                  'flex items-center gap-2 rounded-full px-3 py-1',
                  index === stepIndex ? 'bg-raised text-ink' : index < stepIndex ? 'text-ink-soft' : 'text-ink-mute',
                )}
              >
                <span className={cx('tabular-nums', index === stepIndex && 'text-accent')}>{index + 1}</span>
                {stepName(id, path)}
              </span>
              <ArrowRight aria-hidden className="size-3.5 text-ink-mute" />
            </li>
          ))}
          <li className="px-3 py-1 text-ink-mute">{outcome}</li>
        </ol>

        {makingPage ? (
          <div className="mt-8">
            <PageProgress bookId={makingPage} mode={textMode} />
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-6">
              {step === 'source' && (
                <>
                  <div role="tablist" aria-label="How to start" className="grid grid-cols-2 gap-3">
                    {(
                      [
                        { id: 'idea', icon: Sparkles, title: 'Start from an idea', text: 'Describe the book you want.' },
                        { id: 'import', icon: FileUp, title: 'Import material', text: 'Files, photos or scans you have.' },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        aria-selected={path === option.id}
                        onClick={() => choosePath(option.id)}
                        className={cx(
                          'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                          path === option.id ? 'border-accent bg-raised' : 'border-line-strong hover:border-stone-500',
                        )}
                      >
                        <option.icon
                          aria-hidden
                          className={cx('mt-0.5 size-5 shrink-0', path === option.id ? 'text-accent' : 'text-ink-soft')}
                        />
                        <span>
                          <span className="block font-medium text-ink">{option.title}</span>
                          <span className="block text-sm text-ink-soft">{option.text}</span>
                        </span>
                      </button>
                    ))}
                  </div>

                  {path === 'idea' ? (
                    <>
                      <Field
                        label="What is the book about?"
                        hint="A few sentences is enough: the subject, who it is for, and the tone you want."
                      >
                        <Textarea
                          rows={6}
                          value={concept}
                          onChange={(event) => setConcept(event.target.value)}
                          placeholder="An illustrated field guide to the night sky for curious ten-year-olds, told as a year of backyard stargazing…"
                        />
                      </Field>
                      <Field label="Chapters to plan" className="max-w-xs">
                        <Select value={chapterCount} onChange={(event) => setChapterCount(Number(event.target.value))}>
                          {CHAPTER_COUNTS.map((count) => (
                            <option key={count} value={count}>
                              About {count}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  ) : (
                    <>
                      <div
                        onDragOver={(event) => {
                          event.preventDefault()
                          setDragging(true)
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={onDrop}
                        className={cx(
                          'rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                          dragging ? 'border-accent bg-raised' : 'border-line-strong',
                        )}
                      >
                        <FileUp aria-hidden className="mx-auto size-8 text-accent" />
                        <p className="mt-3 text-lg text-ink">Drop files here</p>
                        <p className="mt-1 text-ink-soft">
                          EPUB, PDF, Word (.docx), text, Markdown and HTML, plus photos and scans of pages (JPEG,
                          PNG, HEIC).
                        </p>
                        <Button variant="secondary" className="mt-5" onClick={() => fileInput.current?.click()}>
                          Choose files
                        </Button>
                        <input
                          ref={fileInput}
                          type="file"
                          multiple
                          hidden
                          accept={ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
                          onChange={(event) => {
                            if (event.target.files) addFiles(event.target.files)
                            event.target.value = ''
                          }}
                        />
                      </div>

                      {rows.length > 0 && (
                        <ul className="divide-y divide-line rounded-lg border border-line">
                          {rows.map((row) => (
                            <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                              <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-soft" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-ink">{row.name}</p>
                                <SourceStatus row={row} />
                              </div>
                              <button
                                type="button"
                                aria-label={`Remove ${row.name}`}
                                onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                                className="grid size-8 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-raised hover:text-ink"
                              >
                                <X className="size-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </>
              )}

              {step === 'make' && (
                <>
                  <OptionCards
                    label="What are you making?"
                    value={kind}
                    onChange={setChosenKind}
                    options={[
                      {
                        value: 'page',
                        icon: File,
                        title: 'A single page',
                        text: 'One page for a book: a contents page, a poem, a recipe. Made straight away.',
                      },
                      {
                        value: 'book',
                        icon: BookOpen,
                        title: 'A book',
                        text: 'Chapters and a cover. You approve the table of contents before anything is written.',
                      },
                    ]}
                  />
                  <OptionCards
                    label="What happens to the words?"
                    value={textMode}
                    onChange={setTextMode}
                    options={[
                      {
                        value: 'preserve',
                        icon: Equal,
                        title: 'Keep the original wording',
                        text: 'The text goes in exactly as it was written.',
                      },
                      {
                        value: 'reword',
                        icon: PenLine,
                        title: 'Rewrite it in new words',
                        text: 'Says the same things in the same order, with every sentence written fresh.',
                      },
                    ]}
                  />
                </>
              )}

              {step === 'look' && (
                <>
                  <OptionCards
                    label={kind === 'page' ? 'Is the page light or dark?' : 'Are the pages light or dark?'}
                    value={theme}
                    onChange={setTheme}
                    options={[
                      {
                        value: 'light',
                        icon: Sun,
                        title: 'Light',
                        text: 'Dark text on light paper throughout. The one to choose for printing.',
                      },
                      {
                        value: 'dark',
                        icon: Moon,
                        title: 'Dark',
                        text: 'Light text and gilt headings on black pages. For the screen; heavy on ink in print.',
                      },
                    ]}
                  />
                  <div className={cx('grid gap-6', kind === 'book' && 'sm:grid-cols-2')}>
                    <div>
                      <h2 className="mb-2 font-medium text-ink">
                        {kind === 'book' ? 'Illustrations inside' : 'Illustration style'}
                      </h2>
                      <StylePicker
                        compact={kind === 'book'}
                        label="Illustration style"
                        value={interiorStyle}
                        onChange={setInteriorStyle}
                      />
                    </div>
                    {kind === 'book' && (
                      <div>
                        <h2 className="mb-2 font-medium text-ink">Front cover</h2>
                        <StylePicker compact label="Cover illustration style" value={coverStyle} onChange={setCoverStyle} />
                      </div>
                    )}
                  </div>
                  {path === 'import' && (
                    <Field
                      label="Anything else you want from it?"
                      hint="Optional. Say how it should look or what the pictures should show."
                    >
                      <Textarea
                        rows={3}
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="A gothic design with gold ornament; ravens and candlelight in the pictures…"
                      />
                    </Field>
                  )}
                </>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-md border border-red-400/40 bg-red-950 px-4 py-3 text-red-200">
                {error}
              </p>
            )}

            <div className="mt-6 flex items-center justify-between">
              {stepIndex > 0 ? (
                <Button variant="ghost" disabled={busy} onClick={() => setStepIndex(stepIndex - 1)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
              ) : (
                <span />
              )}
              {lastStep ? (
                <Button disabled={busy} onClick={() => void finish()} className="h-11 px-6 text-base">
                  {busy ? <Spinner /> : <Sparkles className="size-4" />}
                  {kind === 'page' ? 'Make the page' : busy ? 'Planning…' : 'Plan the book'}
                </Button>
              ) : (
                <Button disabled={!sourceReady} onClick={() => setStepIndex(stepIndex + 1)} className="h-11 px-6 text-base">
                  Continue <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
