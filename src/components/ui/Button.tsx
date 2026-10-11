import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '@/lib/util'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-soft',
  secondary: 'border border-line-strong bg-raised text-ink hover:bg-stone-700',
  ghost: 'text-ink-soft hover:bg-raised hover:text-ink',
  danger: 'border border-red-400/40 bg-red-950 text-red-200 hover:bg-red-900',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
}

// Disabled controls swap to a muted surface rather than fading, so the label stays readable.
const DISABLED =
  'disabled:pointer-events-none disabled:border-transparent disabled:bg-raised disabled:text-ink-mute'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors',
        VARIANTS[variant],
        SIZES[size],
        DISABLED,
        className,
      )}
      {...rest}
    />
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
  children: ReactNode
}

/** Square icon-only button. `label` names it for assistive tech and the tooltip. */
export function IconButton({ label, active, className, type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-grid size-8 shrink-0 place-items-center rounded-md transition-colors',
        active ? 'bg-raised text-accent' : 'text-ink-soft hover:bg-raised hover:text-ink',
        'disabled:pointer-events-none disabled:text-ink-mute',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
