import type { IllustrationStyleId, PageTheme } from '@/types'

/**
 * The illustration service: everything Nebiru asks an image model to do.
 * The ComfyUI-backed implementation will satisfy this same interface.
 */

export interface IllustrationRequest {
  prompt: string
  styleId: IllustrationStyleId
  /** Width divided by height. */
  aspect: number
  purpose: 'interior' | 'cover'
  /** The book's pages; a picture for dark pages is drawn on a dark ground. */
  theme: PageTheme
  /** Reuse a seed to reproduce an image; omit for a fresh one. */
  seed?: number
}

export interface IllustrationResult {
  /** URL or data URL of the finished image. */
  src: string
  seed: number
}

export interface IllustrationService {
  generate(request: IllustrationRequest): Promise<IllustrationResult>
}
