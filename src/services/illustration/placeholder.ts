import { illustrationStyle } from '@/lib/illustrationStyles'
import { seededRandom, sleep } from '@/lib/util'
import type { IllustrationStyleId } from '@/types'
import type { IllustrationService } from './types'

/**
 * Stand-in illustration service used until the ComfyUI backend is connected.
 * It draws a labelled abstract landscape as an SVG so layouts can be judged
 * with art of the right shape and tone in place.
 */

interface Tones {
  top: string
  bottom: string
  ink: string
  /** Line-art styles get a hatching overlay. */
  hatch: boolean
}

// Tailwind palette values, named by token.
const TONES: Record<IllustrationStyleId, Tones> = {
  watercolor: {
    top: 'oklch(90.1% 0.058 230.902)', // sky-200
    bottom: 'oklch(89.2% 0.058 10.001)', // rose-200
    ink: 'oklch(44.6% 0.043 257.281)', // slate-600
    hatch: false,
  },
  pencil: {
    top: 'oklch(97% 0.001 106.424)', // stone-100
    bottom: 'oklch(86.9% 0.005 56.366)', // stone-300
    ink: 'oklch(44.4% 0.011 73.639)', // stone-600
    hatch: true,
  },
  ink: {
    top: 'oklch(98.5% 0.001 106.423)', // stone-50
    bottom: 'oklch(92.3% 0.003 48.717)', // stone-200
    ink: 'oklch(21.6% 0.006 56.043)', // stone-900
    hatch: true,
  },
  engraving: {
    top: 'oklch(96.2% 0.059 95.617)', // amber-100
    bottom: 'oklch(86.9% 0.005 56.366)', // stone-300
    ink: 'oklch(26.8% 0.007 34.298)', // stone-800
    hatch: true,
  },
  classical: {
    top: 'oklch(55.5% 0.163 48.998)', // amber-700
    bottom: 'oklch(26.8% 0.007 34.298)', // stone-800
    ink: 'oklch(21.6% 0.006 56.043)', // stone-900
    hatch: false,
  },
  fantasy: {
    top: 'oklch(35.9% 0.144 278.697)', // indigo-900
    bottom: 'oklch(70.2% 0.183 293.541)', // violet-400
    ink: 'oklch(21.6% 0.006 56.043)', // stone-900
    hatch: false,
  },
  realistic: {
    top: 'oklch(82.8% 0.111 230.318)', // sky-300
    bottom: 'oklch(84.5% 0.143 164.978)', // emerald-300
    ink: 'oklch(37.8% 0.077 168.94)', // emerald-900
    hatch: false,
  },
}

const LIGHT = 'oklch(98.5% 0.001 106.423)' // stone-50

function hill(rand: () => number, w: number, h: number, base: number, amp: number): string {
  const steps = 5
  const span = w / steps
  let d = `M0 ${h} L0 ${base.toFixed(0)}`
  for (let i = 1; i <= steps; i++) {
    const x = span * i
    const cy = base - amp + rand() * amp * 2
    const y = base - amp / 2 + rand() * amp
    d += ` Q${(x - span / 2).toFixed(0)} ${cy.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)}`
  }
  return `${d} L${w} ${h} Z`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function placeholderArt(styleId: IllustrationStyleId, aspect: number, seed: number, label: string): string {
  const tones = TONES[styleId]
  const rand = seededRandom(seed)
  const w = 800
  const h = Math.round(w / aspect)
  const sunX = w * (0.2 + rand() * 0.6)
  const sunY = h * (0.18 + rand() * 0.18)
  const sunR = Math.min(w, h) * (0.08 + rand() * 0.06)
  const hills = [0.58, 0.7, 0.84]
    .map((level, i) => {
      const d = hill(rand, w, h, h * level, h * 0.07)
      return `<path d="${d}" fill="${tones.ink}" opacity="${0.22 + i * 0.24}"/>`
    })
    .join('')
  const hatch = tones.hatch
    ? `<rect width="${w}" height="${h}" fill="url(#hatch)" opacity="0.5"/>`
    : ''
  const fontSize = Math.round(w * 0.028)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${tones.top}"/><stop offset="1" stop-color="${tones.bottom}"/>` +
    `</linearGradient>` +
    `<pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">` +
    `<line x1="0" y1="0" x2="0" y2="9" stroke="${tones.ink}" stroke-width="1.2" opacity="0.35"/>` +
    `</pattern>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>` +
    `<circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${sunR.toFixed(0)}" fill="${LIGHT}" opacity="0.75"/>` +
    hills +
    hatch +
    `<text x="${w / 2}" y="${h - fontSize * 1.4}" text-anchor="middle" font-family="system-ui, sans-serif" ` +
    `font-size="${fontSize}" letter-spacing="2" fill="${LIGHT}">${escapeXml(label.toUpperCase())}</text>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const placeholderIllustration: IllustrationService = {
  async generate({ styleId, aspect, seed }) {
    await sleep(450)
    const usedSeed = seed ?? Math.floor(Math.random() * 2 ** 31)
    const label = `${illustrationStyle(styleId).name} · placeholder`
    return { src: placeholderArt(styleId, aspect, usedSeed, label), seed: usedSeed }
  },
}
