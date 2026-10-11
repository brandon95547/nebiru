import type { SourceDocument } from '@/types'

export interface ParsedSection {
  title: string | null
  paragraphs: string[]
}

export interface ParsedDocument {
  title?: string
  author?: string
  sections: ParsedSection[]
}

/** A block of source text in reading order, before it is grouped into sections. */
export type TextBlock = { kind: 'heading'; level: number; text: string } | { kind: 'text'; text: string }

export type ImportOutcome =
  | { status: 'parsed'; document: SourceDocument }
  /** The format is recognised but needs a backend service that is not running yet. */
  | { status: 'needs-service'; reason: string }
  | { status: 'error'; reason: string }
