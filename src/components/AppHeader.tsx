import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '@/lib/util'
import { connectServices, useServiceStatus } from '@/services'

/**
 * Says which AI features are running on stand-ins instead of real models, or
 * that a live one has a problem. Shows nothing when everything is in order.
 * Clicking it checks again.
 */
export function ServiceStatus() {
  const text = useServiceStatus((state) => state.text)
  const illustration = useServiceStatus((state) => state.illustration)

  const label =
    !text.live && !illustration.live
      ? 'Placeholder AI'
      : !text.live
        ? 'Placeholder writing'
        : !illustration.live
          ? 'Placeholder art'
          : text.detail || illustration.detail
            ? 'AI needs attention'
            : null
  if (!label) return null

  const explain = (name: string, stateOf: typeof text) =>
    stateOf.live
      ? `${name}: connected${stateOf.detail ? `, but ${stateOf.detail}` : '.'}`
      : `${name}: using a built-in stand-in. ${stateOf.detail}`
  const title = [explain('Writing (DeepSeek)', text), explain('Illustration (ComfyUI)', illustration), 'Click to check again.'].join('\n')

  return (
    <button
      type="button"
      title={title}
      onClick={() => void connectServices()}
      className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-line-strong px-3 text-xs font-medium text-ink-soft transition-colors hover:border-stone-500 hover:text-ink"
    >
      <span aria-hidden className={cx('size-1.5 rounded-full', text.live && illustration.live ? 'bg-danger' : 'bg-accent')} />
      {label}
    </button>
  )
}

export function Wordmark() {
  return (
    <Link to="/" className="font-display text-2xl tracking-wide text-ink">
      Nebiru
    </Link>
  )
}

/** Top bar for the library and setup screens. The editor has its own toolbar. */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
        <Wordmark />
        <ServiceStatus />
        <div className="ml-auto flex items-center gap-3">{children}</div>
      </div>
    </header>
  )
}
