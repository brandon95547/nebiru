import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cx } from '@/lib/util'

const CONTROL =
  'w-full rounded-md border border-line-strong bg-canvas text-ink placeholder:text-ink-mute outline-none transition-colors focus:border-accent'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, 'h-10 px-3 text-base', className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, 'px-3 py-2 text-base leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL, 'h-10 px-2 text-base', className)} {...rest}>
      {children}
    </select>
  )
}

interface FieldProps {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}

/** A labelled control. Wrapping in <label> ties the caption to whatever input is inside. */
export function Field({ label, hint, className, children }: FieldProps) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-ink-mute">{hint}</span>}
    </label>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: Array<{ value: T; label: ReactNode; title?: string }>
  onChange: (value: T) => void
  label: string
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-line-strong bg-canvas p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cx(
            'flex h-8 flex-1 items-center justify-center gap-1.5 rounded px-2 text-sm transition-colors',
            option.value === value ? 'bg-raised text-accent' : 'text-ink-soft hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
