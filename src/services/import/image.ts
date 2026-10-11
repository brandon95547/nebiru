import { api } from '../api'
import type { ParsedDocument } from './types'

/** Photos and scans of pages. The server reads the text out of them with the writing model. */

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'tif', 'tiff', 'avif'])

export const IMAGE_FILE_EXTENSIONS = [...IMAGE_EXTENSIONS]

export function isImageFile(file: File, extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension) || file.type.startsWith('image/')
}

// A photographed book arrives as dozens of files at once. Read a few at a
// time, so the model is not sent them all together.
const MAX_AT_ONCE = 3
let reading = 0
const waiting: Array<() => void> = []

async function inTurn<T>(task: () => Promise<T>): Promise<T> {
  if (reading >= MAX_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve))
  reading++
  try {
    return await task()
  } finally {
    reading--
    waiting.shift()?.()
  }
}

interface PageText {
  title: string | null
  /** Structure is kept as markup at the start of a paragraph: "## heading", "1. entry", "- entry". */
  paragraphs: string[]
}

/** One image is one page, and so one section. */
export async function parseImage(file: File): Promise<ParsedDocument> {
  const page = await inTurn(() => api.upload<PageText>('/import/image', file))
  // A page that is only a title still has something to show.
  if (page.paragraphs.length === 0 && page.title) return { sections: [{ title: null, paragraphs: [page.title] }] }
  return { sections: [{ title: page.title, paragraphs: page.paragraphs }] }
}
