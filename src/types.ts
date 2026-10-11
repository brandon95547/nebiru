import type { JSONContent } from '@tiptap/core'

export type IllustrationStyleId =
  | 'watercolor'
  | 'pencil'
  | 'ink'
  | 'engraving'
  | 'classical'
  | 'fantasy'
  | 'realistic'

export type IllustrationPlacement = 'left' | 'right' | 'center' | 'wide' | 'page'
export type IllustrationStatus = 'empty' | 'generating' | 'ready' | 'error'

/** Attributes of an `illustration` node inside a chapter document. */
export interface IllustrationAttrs {
  id: string
  src: string
  prompt: string
  placement: IllustrationPlacement
  /** Width as a percentage of the text column (ignored by wide / page). */
  widthPct: number
  /** Width divided by height. */
  aspect: number
  status: IllustrationStatus
  caption: string
  seed: number | null
}

export interface PageMargins {
  top: number
  bottom: number
  inside: number
  outside: number
}

/** All lengths are inches; type sizes are points. */
export interface PageSettings {
  trimId: string
  widthIn: number
  heightIn: number
  margins: PageMargins
  bodyFont: string
  headingFont: string
  fontSizePt: number
  lineHeight: number
  paragraphStyle: 'indent' | 'spaced'
  justify: boolean
}

export type ChapterStatus = 'planned' | 'writing' | 'ready' | 'error'

export interface Chapter {
  id: string
  title: string
  summary: string
  status: ChapterStatus
  /** Tiptap document; null until the chapter has been written. */
  content: JSONContent | null
  /** Bumped whenever content is replaced from outside the editor. */
  rev: number
  /** Sections of imported material this chapter draws on. */
  sourceSectionIds: string[]
  error?: string
}

export interface SourceSection {
  id: string
  title: string | null
  paragraphs: string[]
}

export interface SourceDocument {
  id: string
  name: string
  format: string
  title?: string
  author?: string
  wordCount: number
  sections: SourceSection[]
}

export type BookOrigin =
  | { kind: 'concept'; concept: string }
  /** preserve: lay out the imported text as written. adapt: write new prose from it. */
  | { kind: 'import'; mode: 'preserve' | 'adapt' }

export interface CoverArt {
  src: string
  prompt: string
  status: IllustrationStatus
  seed: number | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export type BookStatus = 'planning' | 'generating' | 'ready'

export interface Book {
  id: string
  title: string
  author: string
  description: string
  origin: BookOrigin
  sources: SourceDocument[]
  status: BookStatus
  chapters: Chapter[]
  interiorStyle: IllustrationStyleId
  coverStyle: IllustrationStyleId
  cover: CoverArt
  page: PageSettings
  chat: ChatMessage[]
  createdAt: number
  updatedAt: number
}
