import { useEffect, useMemo, useRef, useState } from 'react'
import { pageMetrics } from '@/lib/bookFormats'
import { cx } from '@/lib/util'
import type { Book } from '@/types'
import { BookStrip, EMPTY_LAYOUT, type StripLayout } from './BookStrip'

const THUMB_HEIGHT = 92
const THUMB_GAP = 10
const LABEL_HEIGHT = 20

interface FilmstripProps {
  book: Book
  currentPage: number
  onGoToPage: (index: number) => void
}

/**
 * Page thumbnails. One static copy of the book is drawn at a small scale,
 * with a row of buttons laid over it to number the pages and take clicks.
 */
export function Filmstrip({ book, currentPage, onGoToPage }: FilmstripProps) {
  const metrics = useMemo(() => pageMetrics(book.page), [book.page])
  const [layout, setLayout] = useState<StripLayout>(EMPTY_LAYOUT)
  const currentRef = useRef<HTMLButtonElement>(null)

  const scale = THUMB_HEIGHT / metrics.pageH
  const thumbWidth = metrics.pageW * scale
  const pitch = thumbWidth + THUMB_GAP
  const total = layout.totalPages
  const width = Math.max(0, total * pitch - THUMB_GAP)

  const numbers = useMemo(() => {
    const labels: string[] = []
    for (const section of layout.sections) {
      for (let i = 0; i < section.pages; i++) {
        labels.push(section.firstNumber === null ? '' : String(section.firstNumber + i))
      }
    }
    return labels
  }, [layout])

  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'instant' })
  }, [currentPage])

  return (
    <nav aria-label="Pages" className="scroll-quiet shrink-0 overflow-x-auto overflow-y-hidden border-t border-line bg-panel px-4 py-3">
      <div className="relative" style={{ width, height: THUMB_HEIGHT + LABEL_HEIGHT }}>
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 origin-top-left"
          style={{ transform: `scale(${scale})` }}
        >
          <BookStrip book={book} editable={false} pageGap={THUMB_GAP / scale} onLayout={setLayout} />
        </div>
        {numbers.map((label, index) => {
          const current = index === currentPage
          return (
            <button
              key={index}
              ref={current ? currentRef : undefined}
              type="button"
              aria-label={label ? `Go to page ${label}` : `Go to ${layout.sections.find((s) => index >= s.start && index < s.start + s.pages)?.label ?? 'page'}`}
              aria-current={current ? 'page' : undefined}
              onClick={() => onGoToPage(index)}
              className="absolute top-0 flex flex-col items-center justify-end rounded-sm"
              style={{ left: index * pitch, width: thumbWidth, height: THUMB_HEIGHT + LABEL_HEIGHT }}
            >
              <span
                className={cx(
                  'absolute inset-x-0 top-0 rounded-sm ring-2 transition-shadow',
                  current ? 'ring-accent' : 'ring-transparent hover:ring-stone-500',
                )}
                style={{ height: THUMB_HEIGHT }}
              />
              <span className={cx('text-xs tabular-nums', current ? 'text-accent' : 'text-ink-mute')}>
                {label || '·'}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
