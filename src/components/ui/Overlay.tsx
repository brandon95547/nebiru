import { LoaderCircle } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/util'

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cx('size-4 animate-spin', className)} />
}

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Tailwind max-width class for the panel. */
  width?: string
}

export function Modal({ title, onClose, children, footer, width = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-stone-950/80 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('w-full rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/60', width)}
      >
        <h2 className="border-b border-line px-6 py-4 font-display text-xl text-ink">{title}</h2>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface MenuProps {
  /** Accessible name of the trigger button. */
  label: string
  trigger: ReactNode
  items: MenuItem[]
  className?: string
}

/** A dropdown menu. It is positioned against the viewport so scroll containers cannot clip it. */
export function Menu({ label, trigger, items, className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return
    const anchor = buttonRef.current.getBoundingClientRect()
    const menu = menuRef.current.getBoundingClientRect()
    const left = Math.min(Math.max(8, anchor.right - menu.width), window.innerWidth - menu.width - 8)
    const below = anchor.bottom + 4
    const top = below + menu.height > window.innerHeight - 8 ? anchor.top - menu.height - 4 : below
    setPosition({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return
      if (event.type === 'mousedown') {
        const target = event.target as Node
        if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      }
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className={cx(
          'inline-grid size-8 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-raised hover:text-ink',
          className,
        )}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={position}
            className="fixed z-50 min-w-48 rounded-lg border border-line-strong bg-panel p-1 shadow-xl shadow-black/50"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(false)
                  item.onSelect()
                }}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-raised',
                  item.danger ? 'text-red-300' : 'text-ink-soft hover:text-ink',
                  'disabled:pointer-events-none disabled:text-ink-mute',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
