import type { IllustrationStyleId } from '@/types'

export interface IllustrationStyle {
  id: IllustrationStyleId
  name: string
  /** Style direction appended to every generation prompt for this style. */
  direction: string
  /** Tailwind gradient classes for the style chip. */
  swatch: string
}

export const ILLUSTRATION_STYLES: IllustrationStyle[] = [
  {
    id: 'watercolor',
    name: 'Watercolor',
    direction: 'soft watercolor washes, visible paper grain, loose edges, luminous colour',
    swatch: 'from-sky-200 to-rose-200',
  },
  {
    id: 'pencil',
    name: 'Pencil',
    direction: 'graphite pencil drawing, fine hatching, light sketch lines, monochrome',
    swatch: 'from-stone-100 to-stone-400',
  },
  {
    id: 'ink',
    name: 'Ink',
    direction: 'pen and ink illustration, confident line work, cross-hatching, high contrast',
    swatch: 'from-stone-50 to-stone-700',
  },
  {
    id: 'engraving',
    name: 'Vintage engraving',
    direction: 'antique copperplate engraving, dense parallel lines, aged paper tone',
    swatch: 'from-amber-100 to-stone-500',
  },
  {
    id: 'classical',
    name: 'Classical painting',
    direction: 'classical oil painting, chiaroscuro lighting, rich glazes, old master composition',
    swatch: 'from-amber-700 to-stone-800',
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    direction: 'epic fantasy illustration, dramatic light, ornate detail, painterly atmosphere',
    swatch: 'from-indigo-900 to-violet-400',
  },
  {
    id: 'realistic',
    name: 'Realistic',
    direction: 'photorealistic rendering, natural light, true-to-life texture and depth',
    swatch: 'from-sky-300 to-emerald-700',
  },
]

export function illustrationStyle(id: IllustrationStyleId): IllustrationStyle {
  return ILLUSTRATION_STYLES.find((s) => s.id === id) ?? ILLUSTRATION_STYLES[0]
}
