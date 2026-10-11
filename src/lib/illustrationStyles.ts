import type { IllustrationStyleId } from '@/types'

/** The styles on offer. The prompt language behind each lives on the server, keyed by id. */
export interface IllustrationStyle {
  id: IllustrationStyleId
  name: string
  /** Tailwind gradient classes for the style chip. */
  swatch: string
}

export const ILLUSTRATION_STYLES: IllustrationStyle[] = [
  {
    id: 'watercolor',
    name: 'Watercolor',
    swatch: 'from-sky-200 to-rose-200',
  },
  {
    id: 'pencil',
    name: 'Pencil',
    swatch: 'from-stone-100 to-stone-400',
  },
  {
    id: 'ink',
    name: 'Ink',
    swatch: 'from-stone-50 to-stone-700',
  },
  {
    id: 'engraving',
    name: 'Vintage engraving',
    swatch: 'from-amber-100 to-stone-500',
  },
  {
    id: 'classical',
    name: 'Classical painting',
    swatch: 'from-amber-700 to-stone-800',
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    swatch: 'from-indigo-900 to-violet-400',
  },
  {
    id: 'realistic',
    name: 'Realistic',
    swatch: 'from-sky-300 to-emerald-700',
  },
]

export function illustrationStyle(id: IllustrationStyleId): IllustrationStyle {
  return ILLUSTRATION_STYLES.find((s) => s.id === id) ?? ILLUSTRATION_STYLES[0]
}
