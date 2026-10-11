import type { BookOrigin, ChatMessage, SourceDocument } from '@/types'

/**
 * The writing service: everything Nebiru asks a language model to do.
 * The app only ever talks to this interface, so the DeepSeek-backed
 * implementation can replace the placeholder one without touching the UI.
 */

export interface PlannedChapter {
  /** Set when this entry continues an existing chapter, so its text and sources carry over. */
  id?: string
  title: string
  summary: string
  sourceSectionIds?: string[]
}

export interface BookPlan {
  title: string
  description: string
  chapters: PlannedChapter[]
}

export type PlanInput =
  | { kind: 'concept'; concept: string; chapterCount: number }
  | { kind: 'import'; mode: 'preserve' | 'adapt'; sources: SourceDocument[] }

/** Compact description of the book, sent with every request as context. */
export interface BookBrief {
  title: string
  author: string
  description: string
  origin: BookOrigin
  chapters: Array<{ id: string; title: string; summary: string }>
}

export type RevisionAction = 'grammar' | 'rewrite' | 'expand' | 'shorten' | 'style'

export interface ChapterDraft {
  paragraphs: string[]
  /** One prompt per illustration the chapter should carry. */
  illustrationPrompts: string[]
}

export interface TextService {
  /** Propose a title, description and table of contents. */
  planBook(input: PlanInput): Promise<BookPlan>

  /** Apply a conversational instruction to the table of contents. `chapters` is null when nothing changed. */
  reviseOutline(input: {
    brief: BookBrief
    instruction: string
  }): Promise<{ chapters: PlannedChapter[] | null; reply: string }>

  /** Write one chapter. `sourceParagraphs` holds the imported material it draws on, if any. */
  writeChapter(input: {
    brief: BookBrief
    chapterIndex: number
    sourceParagraphs: string[]
    instruction?: string
  }): Promise<ChapterDraft>

  /** Revise a passage. `note` explains a result the user should know about. */
  reviseText(input: {
    brief: BookBrief
    text: string
    action: RevisionAction
    style?: string
  }): Promise<{ text: string; note?: string }>

  /** Converse about the book. */
  chat(input: {
    brief: BookBrief
    messages: ChatMessage[]
    chapterTitle?: string
    chapterText?: string
  }): Promise<{ reply: string }>
}
