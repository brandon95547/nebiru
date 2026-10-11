import { BookOpen, ChevronLeft, ChevronRight, File, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconButton } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Field'
import { pageMetrics } from '@/lib/bookFormats'
import { clamp } from '@/lib/util'
import type { Book } from '@/types'
import { BookStrip, EMPTY_LAYOUT, type StripLayout } from './BookStrip'
import { viewIndex, viewsFor, type PreviewMode } from './previewViews'

interface PreviewOverlayProps {
  book: Book
  /** The page to open on, counted as the editor counts them. */
  startPage: number
  startMode: PreviewMode
  onClose: () => void
}

/**
 * Full-screen, read-only preview. The whole book is one static strip of pages;
 * moving through it slides the strip behind a window exactly as wide as the
 * page, or pair of pages, on show.
 */
export function PreviewOverlay({ book, startPage, startMode, onClose }: PreviewOverlayProps) {
  const metrics = useMemo(() => pageMetrics(book.page), [book.page])
  const bound = book.kind !== 'page'
  const [layout, setLayout] = useState<StripLayout>(EMPTY_LAYOUT)
  const [mode, setMode] = useState<PreviewMode>(startMode)
  // The page being looked at; which screen that is depends on the mode.
  const [page, setPage] = useState(startPage)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })

  const total = layout.totalPages
  const views = useMemo(() => viewsFor(total, mode, bound), [total, mode, bound])
  const index = viewIndex(views, page)
  const view = views[index] ?? { start: 0, count: 1 }

  // Steps from wherever the preview is by then, so a held key does not lose presses between renders.
  const step = useCallback(
    (by: number) =>
      setPage((current) => views[clamp(viewIndex(views, current) + by, 0, views.length - 1)]?.start ?? 0),
    [views],
  )

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' || event.key === 'PageDown') step(1)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') step(-1)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, step])

  // As large as the screen allows, leaving room for the bar above and the arrows beside.
  const zoom = clamp(
    Math.min((viewport.width - 200) / (metrics.pageW * view.count), (viewport.height - 104) / metrics.pageH),
    0.2,
    3,
  )

  const section = layout.sections.find((s) => view.start >= s.start && view.start < s.start + s.pages)
  const position =
    total === 0
      ? ''
      : view.count === 2
        ? `Pages ${view.start + 1}–${view.start + 2} of ${total}`
        : `${section && section.kind !== 'chapter' ? `${section.label} · ` : ''}Page ${view.start + 1} of ${total}`

  return (
    <div role="dialog" aria-modal="true" aria-label="Preview" className="fixed inset-0 z-40 flex flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-4">
        <h2 className="min-w-0 truncate font-display text-lg text-ink">{book.title || 'Untitled'}</h2>
        <span role="status" className="shrink-0 text-sm text-ink-soft tabular-nums">
          {position}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {total > 1 && (
            <div className="w-72 whitespace-nowrap">
              <Segmented
                label="Preview layout"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'page', label: <><File className="size-4" /> One page</> },
                  { value: 'spread', label: <><BookOpen className="size-4" /> Facing pages</> },
                ]}
              />
            </div>
          )}
          <IconButton label="Close preview" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-4 px-4">
        <IconButton
          label="Previous"
          disabled={index <= 0}
          onClick={() => step(-1)}
          className="size-11"
        >
          <ChevronLeft className="size-6" />
        </IconButton>

        <div
          className="relative shrink-0 overflow-hidden shadow-2xl shadow-black/60"
          style={{ width: metrics.pageW * view.count * zoom, height: metrics.pageH * zoom }}
        >
          <div
            className="origin-top-left"
            style={{ transform: `scale(${zoom}) translateX(${-view.start * metrics.pageW}px)` }}
          >
            <BookStrip book={book} editable={false} pageGap={0} onLayout={setLayout} />
          </div>
          {view.count === 2 && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 w-16 -translate-x-1/2 bg-linear-to-r from-transparent via-stone-950/25 to-transparent"
            />
          )}
        </div>

        <IconButton
          label="Next"
          disabled={index >= views.length - 1}
          onClick={() => step(1)}
          className="size-11"
        >
          <ChevronRight className="size-6" />
        </IconButton>
      </div>
    </div>
  )
}
