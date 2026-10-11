import { ArrowDown, ArrowUp, Ellipsis, ImagePlus, ListOrdered, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Menu, Spinner } from '@/components/ui/Overlay'
import { EMPTY_DOC } from '@/lib/doc'
import { cx } from '@/lib/util'
import { insertChapter, moveChapter, newChapter } from '@/store/library'
import type { Book, Chapter } from '@/types'
import { insertIllustrationAtStart } from './actions'
import type { StripLayout, StripSection } from './BookStrip'

interface ChapterNavProps {
  book: Book
  layout: StripLayout
  currentPage: number
  onGoToPage: (index: number) => void
  onRegenerate: (chapter: Chapter) => void
  onDelete: (chapter: Chapter) => void
}

function NavRow({
  section,
  active,
  lead,
  onClick,
  children,
}: {
  section: StripSection
  active: boolean
  lead?: string
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <li className={cx('group flex items-center rounded-md', active ? 'bg-raised' : 'hover:bg-raised')}>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onClick}
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md py-2 pr-1 pl-2.5 text-left text-sm"
      >
        {lead && <span className="w-5 shrink-0 text-right text-ink-mute tabular-nums">{lead}</span>}
        <span className={cx('min-w-0 flex-1 truncate', active ? 'text-ink' : 'text-ink-soft')}>{section.label}</span>
        {section.firstNumber !== null && (
          <span className="shrink-0 text-xs text-ink-mute tabular-nums">{section.firstNumber}</span>
        )}
      </button>
      {children}
    </li>
  )
}

export function ChapterNav({ book, layout, currentPage, onGoToPage, onRegenerate, onDelete }: ChapterNavProps) {
  const isActive = (section: StripSection) =>
    currentPage >= section.start && currentPage < section.start + section.pages
  const front = layout.sections.filter((section) => section.kind !== 'chapter')
  const chapters = layout.sections.filter((section) => section.kind === 'chapter')

  const addChapter = () => {
    insertChapter(
      book.id,
      book.chapters.length,
      newChapter({ title: 'New chapter', status: 'ready', content: EMPTY_DOC }),
    )
    // The new chapter's first page follows everything laid out so far.
    requestAnimationFrame(() => onGoToPage(layout.totalPages))
  }

  return (
    <nav aria-label="Book sections" className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-2">
        <ul>
          {front.map((section) => (
            <NavRow key={section.key} section={section} active={isActive(section)} onClick={() => onGoToPage(section.start)} />
          ))}
        </ul>

        <h2 className="mt-4 mb-1 px-2.5 text-xs font-medium tracking-wider text-ink-mute uppercase">Chapters</h2>
        <ol>
          {chapters.map((section, index) => {
            const chapter = book.chapters.find((c) => c.id === section.chapterId)
            if (!chapter) return null
            return (
              <NavRow
                key={section.key}
                section={section}
                lead={String(index + 1)}
                active={isActive(section)}
                onClick={() => onGoToPage(section.start)}
              >
                {chapter.status === 'writing' ? (
                  <span className="grid size-8 place-items-center text-accent-soft">
                    <Spinner />
                  </span>
                ) : (
                  <Menu
                    label={`Actions for ${section.label}`}
                    trigger={<Ellipsis className="size-4" />}
                    className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
                    items={[
                      {
                        label: 'Add illustration',
                        icon: <ImagePlus className="size-4" />,
                        onSelect: () => {
                          insertIllustrationAtStart(book.id, chapter)
                          onGoToPage(section.start)
                        },
                      },
                      { label: 'Regenerate chapter…', icon: <RefreshCw className="size-4" />, onSelect: () => onRegenerate(chapter) },
                      {
                        label: 'Move up',
                        icon: <ArrowUp className="size-4" />,
                        disabled: index === 0,
                        onSelect: () => moveChapter(book.id, chapter.id, -1),
                      },
                      {
                        label: 'Move down',
                        icon: <ArrowDown className="size-4" />,
                        disabled: index === chapters.length - 1,
                        onSelect: () => moveChapter(book.id, chapter.id, 1),
                      },
                      { label: 'Delete chapter…', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => onDelete(chapter) },
                    ]}
                  />
                )}
              </NavRow>
            )
          })}
        </ol>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line p-2">
        <button
          type="button"
          onClick={addChapter}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md text-sm text-ink-soft hover:bg-raised hover:text-ink"
        >
          <Plus className="size-4" /> Chapter
        </button>
        <Link
          to={`/book/${book.id}/plan`}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md text-sm text-ink-soft hover:bg-raised hover:text-ink"
        >
          <ListOrdered className="size-4" /> Outline
        </Link>
      </div>
    </nav>
  )
}
