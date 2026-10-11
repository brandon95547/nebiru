import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { services } from '@/services'

/** Tells the user whether real models are behind the AI features. */
export function ServiceStatus() {
  if (services.mode === 'live') return null
  return (
    <span
      title="DeepSeek and ComfyUI are not connected yet. Writing and illustrations use built-in stand-ins."
      className="inline-flex h-7 items-center gap-2 rounded-full border border-line-strong px-3 text-xs font-medium text-ink-soft"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      Placeholder AI
    </span>
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
