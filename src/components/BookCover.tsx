import { illustrationStyle } from '@/lib/illustrationStyles'
import { cx } from '@/lib/util'
import type { Book } from '@/types'

/**
 * The front cover. Type is sized in container units, so the same component
 * serves a library thumbnail and the full-size page in the editor.
 */
export function BookCover({ book, className }: { book: Book; className?: string }) {
  const style = illustrationStyle(book.coverStyle)
  if (book.kind === 'page') {
    // A single page has no cover: show the page itself, in its own paper and ink.
    return (
      <div
        className={cx('bk-book bk-sheet @container relative grid place-items-center overflow-hidden', className)}
        data-theme={book.page.theme}
        style={{ aspectRatio: `${book.page.widthIn} / ${book.page.heightIn}` }}
      >
        <div className="p-[9cqw] text-center">
          <h3 className="font-display text-[9.5cqw] leading-[1.1] font-semibold text-balance break-words" style={{ color: 'var(--bk-heading)' }}>
            {book.title || 'Untitled'}
          </h3>
          <p className="mt-[5cqw] text-[4.2cqw] tracking-[0.22em] uppercase" style={{ color: 'var(--bk-ink-soft)' }}>
            Single page
          </p>
        </div>
      </div>
    )
  }
  return (
    <div
      className={cx('@container relative overflow-hidden bg-stone-800', className)}
      style={{ aspectRatio: `${book.page.widthIn} / ${book.page.heightIn}` }}
    >
      {book.cover.src ? (
        <img src={book.cover.src} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      ) : (
        <div className={cx('absolute inset-0 bg-linear-to-br', style.swatch)} />
      )}
      <div className="absolute inset-0 bg-linear-to-b from-stone-950/75 via-stone-950/10 to-stone-950/85" />
      <div className="absolute inset-0 flex flex-col items-center justify-between p-[9cqw] text-center text-stone-50">
        <h3 className="font-display text-[10.5cqw] leading-[1.08] font-semibold text-balance break-words">
          {book.title || 'Untitled'}
        </h3>
        {book.author && <p className="text-[4.6cqw] tracking-[0.22em] uppercase">{book.author}</p>}
      </div>
    </div>
  )
}
