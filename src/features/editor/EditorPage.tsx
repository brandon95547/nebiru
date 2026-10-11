import {
  ArrowLeft,
  Bold,
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  type LucideIcon,
  MessageSquare,
  Minus,
  Palette,
  Plus,
  Redo2,
  SeparatorHorizontal,
  TextQuote,
  Undo2,
  Image as ImageIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { ServiceStatus } from '@/components/AppHeader'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { Menu, Modal } from '@/components/ui/Overlay'
import { pageMetrics } from '@/lib/bookFormats'
import { clamp, cx, downloadFile, slugify } from '@/lib/util'
import { writeChapter } from '@/services/generation'
import { useEditorHub } from '@/store/editorHub'
import { patchBook, removeChapter, useLibrary } from '@/store/library'
import type { Book, Chapter } from '@/types'
import { insertIllustrationAtCursor } from './actions'
import { BookStrip, EMPTY_LAYOUT, type StripLayout } from './BookStrip'
import { ChapterNav } from './ChapterNav'
import { Filmstrip } from './Filmstrip'
import { ScrollRootContext } from './flow'
import { AssistantPanel } from './panels/AssistantPanel'
import { DesignPanel } from './panels/DesignPanel'
import { IllustrationPanel } from './panels/IllustrationPanel'
import { PreviewOverlay } from './PreviewOverlay'

const PAGE_GAP = 28
const CANVAS_PAD = 36
const ZOOM_STEP = 0.1
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2

type PanelTab = 'assistant' | 'illustration' | 'design'

const TABS: Array<{ id: PanelTab; label: string; icon: LucideIcon }> = [
  { id: 'assistant', label: 'Assistant', icon: MessageSquare },
  { id: 'illustration', label: 'Illustration', icon: ImageIcon },
  { id: 'design', label: 'Design', icon: Palette },
]

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-strong" />
}

/** Formatting controls for whichever chapter holds the cursor. */
function FormatBar() {
  useEditorHub((state) => state.tick)
  const editor = useEditorHub((state) => (state.activeChapterId ? state.editors[state.activeChapterId] : undefined))
  const ready = Boolean(editor && !editor.isDestroyed)
  const run = (command: (chain: ReturnType<NonNullable<typeof editor>['chain']>) => { run: () => boolean }) => {
    if (editor && !editor.isDestroyed) command(editor.chain().focus()).run()
  }

  return (
    // Keep the click from pulling focus (and the selection) out of the page.
    <div role="toolbar" aria-label="Formatting" className="flex items-center" onMouseDown={(event) => event.preventDefault()}>
      <IconButton label="Undo" disabled={!ready || !editor?.can().undo()} onClick={() => run((c) => c.undo())}>
        <Undo2 className="size-4" />
      </IconButton>
      <IconButton label="Redo" disabled={!ready || !editor?.can().redo()} onClick={() => run((c) => c.redo())}>
        <Redo2 className="size-4" />
      </IconButton>
      <Divider />
      <IconButton label="Bold" disabled={!ready} active={ready && editor?.isActive('bold')} onClick={() => run((c) => c.toggleBold())}>
        <Bold className="size-4" />
      </IconButton>
      <IconButton label="Italic" disabled={!ready} active={ready && editor?.isActive('italic')} onClick={() => run((c) => c.toggleItalic())}>
        <Italic className="size-4" />
      </IconButton>
      <IconButton
        label="Section heading"
        disabled={!ready}
        active={ready && editor?.isActive('heading', { level: 2 })}
        onClick={() => run((c) => c.toggleHeading({ level: 2 }))}
      >
        <Heading2 className="size-4" />
      </IconButton>
      <IconButton label="Block quote" disabled={!ready} active={ready && editor?.isActive('blockquote')} onClick={() => run((c) => c.toggleBlockquote())}>
        <TextQuote className="size-4" />
      </IconButton>
      <IconButton label="Scene break" disabled={!ready} onClick={() => run((c) => c.setHorizontalRule())}>
        <SeparatorHorizontal className="size-4" />
      </IconButton>
      <IconButton label="Insert illustration" disabled={!ready} onClick={insertIllustrationAtCursor}>
        <ImagePlus className="size-4" />
      </IconButton>
    </div>
  )
}

function RegenerateDialog({ book, chapter, onClose }: { book: Book; chapter: Chapter; onClose: () => void }) {
  const [instruction, setInstruction] = useState('')
  return (
    <Modal
      title="Regenerate this chapter?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void writeChapter(book.id, chapter.id, instruction.trim() || undefined)
              onClose()
            }}
          >
            Regenerate chapter
          </Button>
        </>
      }
    >
      <p className="mb-4 text-ink-soft">
        “{chapter.title}” will be written again and its current text and illustrations replaced. The rest of
        the book is not touched.
      </p>
      <Field label="Direction for the new version" hint="Leave empty to write it again from the outline.">
        <Textarea
          rows={3}
          autoFocus
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Make it shorter and open with the storm…"
        />
      </Field>
    </Modal>
  )
}

function Workspace({ book }: { book: Book }) {
  const metrics = useMemo(() => pageMetrics(book.page), [book.page])
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [layout, setLayout] = useState<StripLayout>(EMPTY_LAYOUT)
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')
  const [currentPage, setCurrentPage] = useState(0)
  const [tab, setTab] = useState<PanelTab>('assistant')
  const [preview, setPreview] = useState(false)
  const [regenerating, setRegenerating] = useState<Chapter | null>(null)
  const [deleting, setDeleting] = useState<Chapter | null>(null)

  useEffect(() => {
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [canvas])

  // Selecting an illustration on the page brings its controls forward.
  const selectedId = useEditorHub((state) => state.selectedIllustration?.id)
  const lastSelected = useRef(selectedId)
  useEffect(() => {
    if (selectedId && selectedId !== lastSelected.current) setTab('illustration')
    lastSelected.current = selectedId
  }, [selectedId])

  const fitZoom = viewport.height > 0 ? clamp((viewport.height - CANVAS_PAD * 2) / metrics.pageH, MIN_ZOOM, MAX_ZOOM) : 0.75
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode
  const pitch = (metrics.pageW + PAGE_GAP) * zoom
  const total = layout.totalPages
  const stripWidth = Math.max(0, total * metrics.pageW + (total - 1) * PAGE_GAP)

  const pageAt = useCallback(
    (scrollLeft: number) => {
      const centre = scrollLeft + viewport.width / 2 - CANVAS_PAD - (metrics.pageW * zoom) / 2
      return clamp(Math.round(centre / pitch), 0, Math.max(0, total - 1))
    },
    [viewport.width, metrics.pageW, zoom, pitch, total],
  )

  const goToPage = useCallback(
    (index: number) => {
      if (!canvas) return
      const left = CANVAS_PAD + index * pitch + (metrics.pageW * zoom) / 2 - viewport.width / 2
      const far = Math.abs(left - canvas.scrollLeft) > viewport.width * 2
      canvas.scrollTo({ left, behavior: far ? 'instant' : 'smooth' })
    },
    [canvas, pitch, metrics.pageW, zoom, viewport.width],
  )

  const setZoom = (next: number) => setZoomMode(clamp(Math.round(next * 100) / 100, MIN_ZOOM, MAX_ZOOM))
  const section = layout.sections.find((s) => currentPage >= s.start && currentPage < s.start + s.pages)
  const printed = section && section.firstNumber !== null ? section.firstNumber + currentPage - section.start : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <Link
          to="/"
          aria-label="Back to library"
          title="Back to library"
          className="grid size-8 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-raised hover:text-ink"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <input
          aria-label="Book title"
          value={book.title}
          onChange={(event) => patchBook(book.id, { title: event.target.value })}
          className="h-9 w-56 min-w-0 rounded-md border border-transparent bg-transparent px-2 font-display text-lg text-ink outline-none hover:border-line-strong focus:border-accent"
        />
        <Divider />
        <FormatBar />

        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Previous page" disabled={currentPage <= 0} onClick={() => goToPage(currentPage - 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <span role="status" className="min-w-28 text-center text-sm text-ink-soft tabular-nums">
            {printed !== null ? `Page ${printed}` : (section?.label ?? '')}
            <span className="text-ink-mute"> · {Math.min(currentPage + 1, total)}/{total}</span>
          </span>
          <IconButton label="Next page" disabled={currentPage >= total - 1} onClick={() => goToPage(currentPage + 1)}>
            <ChevronRight className="size-4" />
          </IconButton>
          <Divider />
          <IconButton label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(zoom - ZOOM_STEP)}>
            <Minus className="size-4" />
          </IconButton>
          <button
            type="button"
            title="Fit the page to the window"
            onClick={() => setZoomMode('fit')}
            className={cx(
              'h-8 min-w-14 rounded-md px-2 text-sm tabular-nums hover:bg-raised',
              zoomMode === 'fit' ? 'text-accent' : 'text-ink-soft',
            )}
          >
            {zoomMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </button>
          <IconButton label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(zoom + ZOOM_STEP)}>
            <Plus className="size-4" />
          </IconButton>
          <Divider />
          <ServiceStatus />
          <Button variant="secondary" size="sm" onClick={() => setPreview(true)}>
            <Eye className="size-4" /> Preview
          </Button>
          <Menu
            label="Project"
            trigger={<Ellipsis className="size-4" />}
            items={[
              {
                label: 'Download project file',
                icon: <Download className="size-4" />,
                onSelect: () => downloadFile(`${slugify(book.title)}.nebiru.json`, JSON.stringify(book), 'application/json'),
              },
            ]}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ChapterNav
          book={book}
          layout={layout}
          currentPage={currentPage}
          onGoToPage={goToPage}
          onRegenerate={setRegenerating}
          onDelete={setDeleting}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={setCanvas}
            className={cx('scroll-quiet min-h-0 flex-1 overflow-x-auto bg-canvas', zoom > fitZoom ? 'overflow-y-auto' : 'overflow-y-hidden')}
            onScroll={(event) => setCurrentPage(pageAt(event.currentTarget.scrollLeft))}
            onWheel={(event) => {
              // With the page fitted there is nothing to scroll vertically, so the wheel turns pages.
              if (zoom > fitZoom || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
              event.currentTarget.scrollLeft += event.deltaY
            }}
          >
            <div
              className="flex min-h-full items-center"
              style={{ width: stripWidth * zoom + CANVAS_PAD * 2, padding: CANVAS_PAD }}
            >
              <div style={{ width: stripWidth * zoom, height: metrics.pageH * zoom }}>
                <div className="origin-top-left" style={{ width: stripWidth, transform: `scale(${zoom})` }}>
                  <ScrollRootContext value={canvas}>
                    <BookStrip book={book} editable pageGap={PAGE_GAP} onLayout={setLayout} />
                  </ScrollRootContext>
                </div>
              </div>
            </div>
          </div>
          <Filmstrip book={book} currentPage={currentPage} onGoToPage={goToPage} />
        </div>

        <aside aria-label="Tools" className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
          <div role="tablist" className="grid shrink-0 grid-cols-3 border-b border-line">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cx(
                  '-mb-px flex h-11 items-center justify-center gap-1.5 border-b-2 text-sm transition-colors',
                  tab === id ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink',
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          {tab === 'assistant' && <AssistantPanel book={book} />}
          {tab === 'illustration' && <IllustrationPanel book={book} />}
          {tab === 'design' && <DesignPanel book={book} />}
        </aside>
      </div>

      {preview && <PreviewOverlay book={book} onClose={() => setPreview(false)} />}
      {regenerating && <RegenerateDialog book={book} chapter={regenerating} onClose={() => setRegenerating(null)} />}
      {deleting && (
        <Modal
          title="Delete this chapter?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeChapter(book.id, deleting.id)
                  setDeleting(null)
                }}
              >
                Delete chapter
              </Button>
            </>
          }
        >
          <p className="text-ink-soft">“{deleting.title}” and its illustrations will be removed from the book.</p>
        </Modal>
      )}
    </div>
  )
}

export function EditorPage() {
  const { bookId = '' } = useParams()
  const book = useLibrary((state) => state.books[bookId])

  if (!book) return <Navigate to="/" replace />
  // Nothing written yet: the outline comes first.
  if (!book.chapters.some((chapter) => chapter.content)) return <Navigate to={`/book/${book.id}/plan`} replace />
  return <Workspace key={book.id} book={book} />
}
