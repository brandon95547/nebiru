import type { LucideIcon } from 'lucide-react'
import { cx } from '@/lib/util'

export interface CardOption<T extends string> {
  value: T
  title: string
  text: string
  icon?: LucideIcon
}

interface OptionCardsProps<T extends string> {
  /** The question these cards answer; also names the group for assistive tech. */
  label: string
  value: T
  options: Array<CardOption<T>>
  onChange: (value: T) => void
}

/** A choice between a few peers, each explained in a sentence. Laid out side by side so they can be compared. */
export function OptionCards<T extends string>({ label, value, options, onChange }: OptionCardsProps<T>) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium text-ink">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(({ value: option, title, text, icon: Icon }) => {
          const selected = option === value
          return (
            <label
              key={option}
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent',
                selected ? 'border-accent bg-raised' : 'border-line-strong hover:border-stone-500',
              )}
            >
              <input
                type="radio"
                name={label}
                className="sr-only"
                checked={selected}
                onChange={() => onChange(option)}
              />
              {Icon && <Icon aria-hidden className={cx('mt-0.5 size-5 shrink-0', selected ? 'text-accent' : 'text-ink-soft')} />}
              <span>
                <span className="block font-medium text-ink">{title}</span>
                <span className="mt-1 block text-sm text-ink-soft">{text}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
