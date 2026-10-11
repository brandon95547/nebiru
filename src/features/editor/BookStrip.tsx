import { generateHTML, type JSONContent } from '@tiptap/core'
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BookCover } from '@/components/BookCover'
import { BODY_FONTS, fontStack, HEADING_FONTS, type PageMetrics, pageMetrics } from '@/lib/bookFormats'
import { EMPTY_DOC } from '@/lib/doc'
import { liveEditor } from '@/store/editorHub'
import { patchChapter } from '@/store/library'
import type { Book, Chapter } from '@/types'
import { ChapterEditor } from './ChapterEditor'
import { bookExtensions } from './extensions'
import { RemeasureContext, ScrollRootContext, useRemeasure } from './flow'

/**
 * The book laid out as a row of pages.
 *
 * Each section's text lives in one CSS multi-column box whose columns are
 * exactly one page's text block wide and tall, spaced so that every column
 * lands on its own sheet. The browser therefore does the pagination: text
 * flows from page to page, wraps around floated illustrations and splits
 * paragraphs at page ends, while staying a single editable document.
 */

export interface StripSection {
  key: string
  kind: 'cover' | 'title' | 'contents' | 'chapter'
  chapterId?: string
  label: string
  /** Index of the section's first page within the strip. */
  start: number
  pages: number
  /** Printed number of the first page, or null for unnumbered front matter. */
  firstNumber: number | null
}

export interface StripLayout {
  sections: StripSection[]
  totalPages: number
}

export const EMPTY_LAYOUT: StripLayout = { sections: [], totalPages: 0 }

function computeLayout(book: Book, counts: Record<string, number>, includeCover: boolean): StripLayout {
  const sections: StripSection[] = []
  let start = 0
  let number = 1
  const add = (section: Omit<StripSection, 'start' | 'firstNumber'>, numbered: boolean) => {
    sections.push({ ...section, start, firstNumber: numbered ? number : null })
    start += section.pages
    if (numbered) number += section.pages
  }

  if (includeCover) add({ key: 'cover', kind: 'cover', label: 'Cover', pages: 1 }, false)
  add({ key: 'title', kind: 'title', label: 'Title page', pages: 1 }, false)
  add({ key: 'contents', kind: 'contents', label: 'Contents', pages: counts.contents ?? 1 }, false)
  book.chapters.forEach((chapter, index) => {
    add(
      {
        key: chapter.id,
        kind: 'chapter',
        chapterId: chapter.id,
        label: chapter.title || `Chapter ${index + 1}`,
        pages: counts[chapter.id] ?? 1,
      },
      true,
    )
  })
  return { sections, totalPages: start }
}

const SHEET = 'bg-paper shadow-xl shadow-black/40'

function Sheet({ index, metrics, children }: { index: number; metrics: PageMetrics; children: ReactNode }) {
  return (
    <div
      data-page={index}
      className={`relative flex-none overflow-hidden ${SHEET}`}
      style={{ width: metrics.pageW, height: metrics.pageH }}
    >
      {children}
    </div>
  )
}

interface FlowSectionProps {
  sectionKey: string
  metrics: PageMetrics
  pageGap: number
  start: number
  firstNumber: number | null
  paragraphStyle: 'indent' | 'spaced'
  onPages: (key: string, pages: number) => void
  sectionRef?: (element: HTMLElement | null) => void
  children: ReactNode
}

/** One run of flowing text and the sheets it spreads across. */
function FlowSection({
  sectionKey,
  metrics,
  pageGap,
  start,
  firstNumber,
  paragraphStyle,
  onPages,
  sectionRef,
  children,
}: FlowSectionProps) {
  const flowRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(1)
  const columnGap = metrics.mx * 2 + pageGap
  const pitch = metrics.pageW + pageGap

  const measure = useCallback(() => {
    const flow = flowRef.current
    if (!flow) return
    // Overflowing columns extend the scroll width by one column plus one gap each.
    const count = Math.max(1, Math.round((flow.scrollWidth + columnGap) / (metrics.colW + columnGap)))
    setPages((current) => (current === count ? current : count))
  }, [columnGap, metrics.colW])

  useLayoutEffect(measure)

  useEffect(() => {
    onPages(sectionKey, pages)
  }, [onPages, sectionKey, pages])

  // Late-arriving fonts and images change how much fits on a page.
  useEffect(() => {
    const flow = flowRef.current
    if (!flow) return
    let mounted = true
    flow.addEventListener('load', measure, true)
    void document.fonts.ready.then(() => mounted && measure())
    return () => {
      mounted = false
      flow.removeEventListener('load', measure, true)
    }
  }, [measure])

  return (
    <section
      ref={sectionRef}
      className="relative flex-none"
      style={{ width: pages * metrics.pageW + (pages - 1) * pageGap, height: metrics.pageH }}
    >
      {Array.from({ length: pages }, (_, i) => (
        <div
          key={i}
          data-page={start + i}
          className={`absolute top-0 ${SHEET}`}
          style={{ left: i * pitch, width: metrics.pageW, height: metrics.pageH }}
        >
          {firstNumber !== null && (
            <span
              className="absolute inset-x-0 text-center text-print-soft"
              style={{
                bottom: metrics.mb * 0.42,
                fontFamily: 'var(--bk-body-font)',
                fontSize: metrics.fontPx * 0.85,
                lineHeight: 1,
              }}
            >
              {firstNumber + i}
            </span>
          )}
        </div>
      ))}
      <RemeasureContext value={measure}>
        <div
          ref={flowRef}
          className="bk-flow absolute"
          data-para={paragraphStyle}
          style={{
            left: metrics.mx,
            top: metrics.mt,
            width: metrics.colW,
            height: metrics.colH,
            columnWidth: metrics.colW,
            columnGap,
          }}
        >
          {children}
        </div>
      </RemeasureContext>
    </section>
  )
}

const OWN_LABEL = /^(?:chapter|part|book|prologue|epilogue|introduction|preface|foreword|afterword|appendix|conclusion)\b/i

function ChapterTitle({ bookId, chapter, editable }: { bookId: string; chapter: Chapter; editable: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null)
  const remeasure = useRemeasure()

  // The heading is edited in place, so React must not rewrite it under the caret.
  useLayoutEffect(() => {
    const heading = ref.current
    if (heading && heading.textContent !== chapter.title) heading.textContent = chapter.title
  }, [chapter.title, editable])

  if (!editable) return <h1 className="bk-chapter-title">{chapter.title}</h1>
  return (
    <h1
      ref={ref}
      className="bk-chapter-title"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      aria-label="Chapter title"
      onInput={(event) => {
        patchChapter(bookId, chapter.id, { title: (event.currentTarget.textContent ?? '').replace(/\s*\n\s*/g, ' ') })
        remeasure()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        liveEditor(chapter.id)?.commands.focus('start')
      }}
    />
  )
}

function StaticBody({ content }: { content: JSONContent | null }) {
  const html = useMemo(() => generateHTML(content ?? EMPTY_DOC, bookExtensions), [content])
  return <div className="tiptap ProseMirror" dangerouslySetInnerHTML={{ __html: html }} />
}

/** How far outside the visible area a chapter still gets a live editor. */
const LIVE_MARGIN = '0px 2400px'

interface ChapterSectionProps {
  bookId: string
  chapter: Chapter
  number: number
  start: number
  firstNumber: number | null
  metrics: PageMetrics
  pageGap: number
  paragraphStyle: 'indent' | 'spaced'
  editable: boolean
  onPages: (key: string, pages: number) => void
}

const ChapterSection = memo(function ChapterSection({
  bookId,
  chapter,
  number,
  editable,
  ...flow
}: ChapterSectionProps) {
  const scrollRoot = useContext(ScrollRootContext)
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [near, setNear] = useState(false)

  // Only chapters close to the viewport carry a live editor; the rest are
  // static HTML with identical layout, which keeps long books responsive.
  useEffect(() => {
    if (!editable || !element || !scrollRoot) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: scrollRoot,
      rootMargin: LIVE_MARGIN,
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [editable, element, scrollRoot])

  const live = editable && near
  return (
    <FlowSection sectionKey={chapter.id} sectionRef={setElement} {...flow}>
      {!OWN_LABEL.test(chapter.title.trim()) && (
        <p className="bk-chapter-kicker" contentEditable={false}>
          Chapter {number}
        </p>
      )}
      <ChapterTitle bookId={bookId} chapter={chapter} editable={live} />
      {live ? <ChapterEditor bookId={bookId} chapter={chapter} /> : <StaticBody content={chapter.content} />}
    </FlowSection>
  )
})

interface BookStripProps {
  book: Book
  /** Editable strips mount live editors; static ones render the same pages as plain HTML. */
  editable: boolean
  /** Space between sheets, in page pixels. */
  pageGap: number
  includeCover?: boolean
  onLayout?: (layout: StripLayout) => void
}

export function BookStrip({ book, editable, pageGap, includeCover = true, onLayout }: BookStripProps) {
  const { page } = book
  const metrics = useMemo(() => pageMetrics(page), [page])
  const [counts, setCounts] = useState<Record<string, number>>({})

  const onPages = useCallback((key: string, pages: number) => {
    setCounts((current) => (current[key] === pages ? current : { ...current, [key]: pages }))
  }, [])

  const layout = useMemo(() => computeLayout(book, counts, includeCover), [book, counts, includeCover])
  const sections = useMemo(() => new Map(layout.sections.map((section) => [section.key, section])), [layout])

  useEffect(() => {
    onLayout?.(layout)
  }, [layout, onLayout])

  const style = {
    gap: pageGap,
    '--bk-body-font': fontStack(BODY_FONTS, page.bodyFont),
    '--bk-heading-font': fontStack(HEADING_FONTS, page.headingFont),
    '--bk-font-size': `${metrics.fontPx}px`,
    '--bk-line-height': String(page.lineHeight),
    '--bk-align': page.justify ? 'justify' : 'left',
    '--bk-col-h': `${metrics.colH}px`,
    '--bk-mx': `${metrics.mx}px`,
    '--bk-mt': `${metrics.mt}px`,
    '--bk-mb': `${metrics.mb}px`,
  } as CSSProperties

  const flowProps = { metrics, pageGap, paragraphStyle: page.paragraphStyle, onPages }
  const contents = sections.get('contents')

  return (
    <div className="flex" style={style}>
      {includeCover && (
        <Sheet index={sections.get('cover')?.start ?? 0} metrics={metrics}>
          <BookCover book={book} className="size-full" />
        </Sheet>
      )}

      <Sheet index={sections.get('title')?.start ?? 0} metrics={metrics}>
        <div
          className="flex h-full flex-col items-center text-center text-print"
          style={{
            padding: `${metrics.mt}px ${metrics.mx}px ${metrics.mb}px`,
            fontFamily: 'var(--bk-body-font)',
            fontSize: metrics.fontPx,
          }}
        >
          <div
            className="mt-[24%] font-semibold text-balance"
            style={{ fontFamily: 'var(--bk-heading-font)', fontSize: '2.6em', lineHeight: 1.1 }}
          >
            {book.title}
          </div>
          {book.author && <div className="mt-auto mb-[6%] tracking-[0.2em] uppercase">{book.author}</div>}
        </div>
      </Sheet>

      <FlowSection sectionKey="contents" start={contents?.start ?? 0} firstNumber={null} {...flowProps}>
        <h1 className="bk-chapter-title bk-contents-title">Contents</h1>
        {layout.sections.map(
          (section) =>
            section.kind === 'chapter' && (
              <div key={section.key} className="bk-toc-row">
                <span>{section.label}</span>
                <span aria-hidden className="bk-toc-dots" />
                <span>{section.firstNumber}</span>
              </div>
            ),
        )}
      </FlowSection>

      {book.chapters.map((chapter, index) => {
        const section = sections.get(chapter.id)
        return (
          <ChapterSection
            key={chapter.id}
            bookId={book.id}
            chapter={chapter}
            number={index + 1}
            start={section?.start ?? 0}
            firstNumber={section?.firstNumber ?? null}
            editable={editable}
            {...flowProps}
          />
        )
      })}
    </div>
  )
}
