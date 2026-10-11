import type { PageMargins, PageSettings } from '@/types'

export const PX_PER_IN = 96
const PX_PER_PT = PX_PER_IN / 72

export interface TrimSize {
  id: string
  label: string
  widthIn: number
  heightIn: number
}

export const TRIM_SIZES: TrimSize[] = [
  { id: '5x8', label: '5 × 8 in — Pocket', widthIn: 5, heightIn: 8 },
  { id: '5.5x8.5', label: '5.5 × 8.5 in — Digest', widthIn: 5.5, heightIn: 8.5 },
  { id: '6x9', label: '6 × 9 in — Trade', widthIn: 6, heightIn: 9 },
  { id: 'a5', label: 'A5 — 148 × 210 mm', widthIn: 5.83, heightIn: 8.27 },
  { id: '7x10', label: '7 × 10 in — Illustrated', widthIn: 7, heightIn: 10 },
  { id: '8.5x8.5', label: '8.5 × 8.5 in — Square', widthIn: 8.5, heightIn: 8.5 },
  { id: '8.5x11', label: '8.5 × 11 in — Letter', widthIn: 8.5, heightIn: 11 },
]

export interface FontChoice {
  id: string
  label: string
  stack: string
}

export const BODY_FONTS: FontChoice[] = [
  { id: 'eb-garamond', label: 'EB Garamond', stack: '"EB Garamond Variable", Garamond, Georgia, serif' },
  { id: 'lora', label: 'Lora', stack: '"Lora Variable", Georgia, serif' },
  { id: 'source-serif', label: 'Source Serif', stack: '"Source Serif 4 Variable", Georgia, serif' },
  { id: 'literata', label: 'Literata', stack: '"Literata Variable", Georgia, serif' },
  { id: 'inter', label: 'Inter (sans)', stack: '"Inter Variable", system-ui, sans-serif' },
]

export const HEADING_FONTS: FontChoice[] = [
  { id: 'body', label: 'Same as body', stack: 'inherit' },
  { id: 'playfair', label: 'Playfair Display', stack: '"Playfair Display Variable", Georgia, serif' },
  { id: 'cinzel', label: 'Cinzel', stack: '"Cinzel Variable", Georgia, serif' },
  { id: 'inter', label: 'Inter (sans)', stack: '"Inter Variable", system-ui, sans-serif' },
]

export function fontStack(list: FontChoice[], id: string): string {
  return (list.find((f) => f.id === id) ?? list[0]).stack
}

export const DEFAULT_MARGINS: PageMargins = { top: 0.75, bottom: 0.85, inside: 0.8, outside: 0.6 }

export const DEFAULT_PAGE: PageSettings = {
  trimId: '6x9',
  widthIn: 6,
  heightIn: 9,
  margins: DEFAULT_MARGINS,
  bodyFont: 'eb-garamond',
  headingFont: 'playfair',
  fontSizePt: 11.5,
  lineHeight: 1.45,
  paragraphStyle: 'indent',
  justify: true,
}

/** Page geometry in CSS pixels. */
export interface PageMetrics {
  pageW: number
  pageH: number
  /** Horizontal margin on each side of the text column. */
  mx: number
  mt: number
  mb: number
  colW: number
  colH: number
  fontPx: number
}

export function pageMetrics(page: PageSettings): PageMetrics {
  const pageW = Math.round(page.widthIn * PX_PER_IN)
  const pageH = Math.round(page.heightIn * PX_PER_IN)
  // The editor centres the text column: inside and outside margins only swap
  // sides between left and right pages, so averaging them keeps every line
  // break identical to the mirrored print layout.
  const mx = Math.round(((page.margins.inside + page.margins.outside) / 2) * PX_PER_IN)
  const mt = Math.round(page.margins.top * PX_PER_IN)
  const mb = Math.round(page.margins.bottom * PX_PER_IN)
  return {
    pageW,
    pageH,
    mx,
    mt,
    mb,
    colW: pageW - mx * 2,
    colH: pageH - mt - mb,
    fontPx: page.fontSizePt * PX_PER_PT,
  }
}
