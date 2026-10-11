import { Check } from 'lucide-react'
import { ILLUSTRATION_STYLES } from '@/lib/illustrationStyles'
import { cx } from '@/lib/util'
import type { IllustrationStyleId } from '@/types'

interface StylePickerProps {
  label: string
  value: IllustrationStyleId
  onChange: (value: IllustrationStyleId) => void
  /** Narrow panels use a tighter grid. */
  compact?: boolean
}

export function StylePicker({ label, value, onChange, compact }: StylePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]')}
    >
      {ILLUSTRATION_STYLES.map((style) => {
        const selected = style.id === value
        return (
          <button
            key={style.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(style.id)}
            className={cx(
              'flex items-center gap-2.5 rounded-lg border p-1.5 text-left text-sm transition-colors',
              selected
                ? 'border-accent bg-raised text-ink'
                : 'border-line-strong text-ink-soft hover:border-stone-500 hover:text-ink',
            )}
          >
            <span
              aria-hidden
              className={cx('grid size-8 shrink-0 place-items-center rounded-md bg-linear-to-br', style.swatch)}
            >
              {selected && <Check className="size-4 text-stone-950" />}
            </span>
            <span className="leading-tight">{style.name}</span>
          </button>
        )
      })}
    </div>
  )
}
