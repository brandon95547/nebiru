import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BookCover } from '@/components/BookCover'
import { IconButton } from '@/components/ui/Button'
import { pageMetrics } from '@/lib/bookFormats'
import { clamp } from '@/lib/util'
import type { Book } from '@/types'
import { BookStrip, EMPTY_LAYOUT, type StripLayout } from './BookStrip'

const COVER = -1

/**
 * Read-only preview of the bound book: the cover, then facing pages. The
 * interior is one static strip; turning the page slides it two sheets along
 * behind a window that is exactly one spread wide.
 */
export function PreviewOverlay({ book, onClose }: { book: Book; onClose: () => void }) {
  const metrics = useMemo(() => pageMetrics(book.page), [book.page])
  const [layout, setLayout] = useState<StripLayout>(EMPTY_LAYOUT)
  const [spread, setSpread] = useState(COVER)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })

  const total = layout.totalPages
  // Spread k shows interior pages 2k-1 and 2k, so the first page sits alone on the right.
  const lastSpread = Math.floor(total / 2)
  const turn = (delta: number) => setSpread((current) => clamp(current + delta, COVER, lastSpread))

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' || event.key === 'PageDown') setSpread((s) => clamp(s + 1, COVER, lastSpread))
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') setSpread((s) => clamp(s - 1, COVER, lastSpread))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, lastSpread])

  const zoom = clamp(
    Math.min((viewport.width - 220) / (metrics.pageW * 2), (viewport.height - 150) / metrics.pageH),
    0.2,
    1.6,
  )

  const left = spread * 2 - 1
  const right = spread * 2
  const position =
    spread === COVER
      ? 'Cover'
      : left < 0
        ? `Page 1 of ${total}`
        : right >= total
          ? `Page ${left + 1} of ${total}`
          : `Pages ${left + 1}–${right + 1} of ${total}`

  return (
    <div role="dialog" aria-modal="true" aria-label="Book preview" className="fixed inset-0 z-40 flex flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-4">
        <h2 className="font-display text-lg text-ink">{book.title || 'Untitled'}</h2>
        <span className="text-sm text-ink-mute">Preview</span>
        <span role="status" className="ml-auto text-sm text-ink-soft tabular-nums">
          {position}
        </span>
        <IconButton label="Close preview" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-6 px-6">
        <IconButton label="Previous pages" disabled={spread === COVER} onClick={() => turn(-1)} className="size-11">
          <ChevronLeft className="size-6" />
        </IconButton>

        <div className="relative shrink-0" style={{ width: metrics.pageW * 2 * zoom, height: metrics.pageH * zoom }}>
          {/* The interior stays mounted while the cover shows so its pages are already counted. */}
          <div className="absolute inset-0 overflow-hidden" style={{ visibility: spread === COVER ? 'hidden' : 'visible' }}>
            <div
              className="origin-top-left transition-transform duration-300"
              style={{ transform: `scale(${zoom}) translateX(${-left * metrics.pageW}px)` }}
            >
              <BookStrip book={book} editable={false} pageGap={0} includeCover={false} onLayout={setLayout} />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 w-16 -translate-x-1/2 bg-linear-to-r from-transparent via-stone-900/20 to-transparent"
            />
          </div>
          {spread === COVER && (
            <div className="absolute inset-y-0 left-1/4 w-1/2">
              <BookCover book={book} className="size-full shadow-2xl shadow-black/60" />
            </div>
          )}
        </div>

        <IconButton label="Next pages" disabled={spread >= lastSpread} onClick={() => turn(1)} className="size-11">
          <ChevronRight className="size-6" />
        </IconButton>
      </div>
    </div>
  )
}
