import { ArrowLeft, CircleAlert, CircleCheck, Clock, FileText, FileUp, Sparkles, X } from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Overlay'
import { cx, plural, uid } from '@/lib/util'
import { services } from '@/services'
import { ACCEPTED_EXTENSIONS, importFile } from '@/services/import'
import type { PlanInput } from '@/services/text/types'
import { createBook } from '@/store/library'
import type { BookOrigin, SourceDocument } from '@/types'

type Mode = 'idea' | 'import'

interface SourceRow {
  id: string
  name: string
  status: 'reading' | 'parsed' | 'needs-service' | 'error'
  document?: SourceDocument
  reason?: string
}

const CHAPTER_COUNTS = [5, 8, 10, 12, 15, 20, 25, 30]

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

export function NewBookPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'import' ? 'import' : 'idea')
  const [concept, setConcept] = useState('')
  const [chapterCount, setChapterCount] = useState(10)
  const [author, setAuthor] = useState('')
  const [rows, setRows] = useState<SourceRow[]>([])
  const [importMode, setImportMode] = useState<'preserve' | 'adapt'>('preserve')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const sources = rows.flatMap((row) => (row.document ? [row.document] : []))
  const reading = rows.some((row) => row.status === 'reading')
  const canSubmit = !busy && (mode === 'idea' ? concept.trim().length >= 10 : sources.length > 0 && !reading)

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
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
        if (outcome.status === 'parsed' && outcome.document.author) {
          setAuthor((current) => current || outcome.document.author || '')
        }
      })
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const input: PlanInput =
        mode === 'idea'
          ? { kind: 'concept', concept: concept.trim(), chapterCount }
          : { kind: 'import', mode: importMode, sources }
      const origin: BookOrigin =
        mode === 'idea' ? { kind: 'concept', concept: concept.trim() } : { kind: 'import', mode: importMode }
      const plan = await services.text.planBook(input)
      const book = createBook({
        title: plan.title,
        author: author.trim(),
        description: plan.description,
        origin,
        sources: mode === 'import' ? sources : [],
        chapters: plan.chapters.map((chapter) => ({
          title: chapter.title,
          summary: chapter.summary,
          sourceSectionIds: chapter.sourceSectionIds ?? [],
        })),
      })
      navigate(`/book/${book.id}/plan`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The book could not be planned.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-2 rounded text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" /> Library
        </Link>
        <h1 className="mt-4 font-display text-4xl text-ink">New book</h1>
        <p className="mt-2 text-lg text-ink-soft">
          Nebiru drafts a title, description and table of contents for you to review before anything is written.
        </p>

        <div role="tablist" aria-label="How to start" className="mt-8 grid grid-cols-2 gap-3">
          {(
            [
              { id: 'idea', icon: Sparkles, title: 'Start from an idea', text: 'Describe the book you want.' },
              { id: 'import', icon: FileUp, title: 'Import material', text: 'Build from files you already have.' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={mode === option.id}
              onClick={() => setMode(option.id)}
              className={cx(
                'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                mode === option.id ? 'border-accent bg-panel' : 'border-line-strong hover:border-stone-500',
              )}
            >
              <option.icon aria-hidden className={cx('mt-0.5 size-5 shrink-0', mode === option.id ? 'text-accent' : 'text-ink-soft')} />
              <span>
                <span className="block font-medium text-ink">{option.title}</span>
                <span className="block text-sm text-ink-soft">{option.text}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-6">
          {mode === 'idea' ? (
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
              <div className="grid grid-cols-2 gap-4">
                <Field label="Chapters to plan">
                  <Select value={chapterCount} onChange={(event) => setChapterCount(Number(event.target.value))}>
                    {CHAPTER_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        About {count}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Author name">
                  <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Optional" />
                </Field>
              </div>
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
                  EPUB, PDF, Word (.docx), text, Markdown and HTML are read in your browser.
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

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-soft">What should Nebiru do with it?</legend>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { id: 'preserve', title: 'Keep the text', text: 'Lay out and illustrate the material as it is written.' },
                      { id: 'adapt', title: 'Write an adaptation', text: 'New prose and structure built on its ideas and facts.' },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.id}
                      className={cx(
                        'cursor-pointer rounded-lg border p-4 transition-colors',
                        importMode === option.id ? 'border-accent bg-raised' : 'border-line-strong hover:border-stone-500',
                      )}
                    >
                      <input
                        type="radio"
                        name="import-mode"
                        className="sr-only"
                        checked={importMode === option.id}
                        onChange={() => setImportMode(option.id)}
                      />
                      <span className="block font-medium text-ink">{option.title}</span>
                      <span className="mt-1 block text-sm text-ink-soft">{option.text}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <Field label="Author name" className="max-w-sm">
                <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Optional" />
              </Field>
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-md border border-red-400/40 bg-red-950 px-4 py-3 text-red-200">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <Button disabled={!canSubmit} onClick={() => void submit()} className="h-11 px-6 text-base">
            {busy ? <Spinner /> : <Sparkles className="size-4" />}
            {busy ? 'Planning…' : 'Plan the book'}
          </Button>
        </div>
      </main>
    </div>
  )
}
