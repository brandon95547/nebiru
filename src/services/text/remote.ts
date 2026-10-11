import { countWords } from '@/lib/util'
import type { SourceDocument } from '@/types'
import { api } from '../api'
import type { BookPlan, ChapterDraft, PlannedChapter, TextService } from './types'

/** The writing service backed by DeepSeek, through the Nebiru server. */

const EXCERPT_WORDS = 110
const LONG_CHAPTER_WORDS = 2500

function firstWords(text: string, limit: number): string {
  const words = text.split(/\s+/)
  return words.length <= limit ? text : words.slice(0, limit).join(' ')
}

/** Planning needs to know what each section is, not to read all of it. */
function digest(source: SourceDocument) {
  return {
    name: source.name,
    title: source.title,
    author: source.author,
    sections: source.sections.map((section) => {
      const text = section.paragraphs.join(' ')
      return { id: section.id, title: section.title, wordCount: countWords(text), excerpt: firstWords(text, EXCERPT_WORDS) }
    }),
  }
}

interface WirePlannedChapter {
  id: string | null
  title: string
  summary: string
  sourceSectionIds: string[]
}

function planned(chapter: WirePlannedChapter): PlannedChapter {
  return { ...chapter, id: chapter.id ?? undefined }
}

export const remoteText: TextService = {
  async planBook(input) {
    const body =
      input.kind === 'concept'
        ? input
        : { kind: 'import', mode: input.mode, instruction: input.instruction ?? '', sources: input.sources.map(digest) }
    const plan = await api.post<Omit<BookPlan, 'chapters'> & { chapters: WirePlannedChapter[] }>('/text/plan', body)
    return { ...plan, chapters: plan.chapters.map(planned) }
  },

  async reviseOutline(input) {
    const result = await api.post<{ chapters: WirePlannedChapter[] | null; reply: string }>('/text/outline', input)
    return { reply: result.reply, chapters: result.chapters ? result.chapters.map(planned) : null }
  },

  async writeChapter(input): Promise<ChapterDraft> {
    const { brief, chapterIndex, sourceParagraphs } = input
    const keepsSource = brief.origin.kind === 'import' && brief.origin.mode === 'preserve' && sourceParagraphs.length > 0
    if (!keepsSource) return api.post<ChapterDraft>('/text/chapter', input)

    // The text is the author's own and stays as it is; the model only picks what to illustrate.
    const text = sourceParagraphs.join('\n\n')
    try {
      const { prompts } = await api.post<{ prompts: string[] }>('/text/illustration-prompts', {
        brief,
        chapterIndex,
        text: firstWords(text, LONG_CHAPTER_WORDS),
        count: countWords(text) > LONG_CHAPTER_WORDS ? 2 : 1,
      })
      return { paragraphs: sourceParagraphs, illustrationPrompts: prompts }
    } catch (error) {
      // Losing the illustration ideas is no reason to lose the chapter: keep the text and say what happened.
      const reason = error instanceof Error ? error.message : 'unknown error'
      return { paragraphs: sourceParagraphs, illustrationPrompts: [], note: `No illustrations were planned: ${reason}` }
    }
  },

  async reviseText(input) {
    const result = await api.post<{ text: string; note: string | null }>('/text/revise', input)
    return { text: result.text, note: result.note ?? undefined }
  },

  async chat({ brief, messages, chapterTitle, chapterText }) {
    const result = await api.post<{ reply: string; revisedChapter: string[] | null }>('/text/chat', {
      brief,
      messages: messages.map(({ role, text }) => ({ role, text })),
      chapterTitle,
      chapterText,
    })
    return { reply: result.reply, revisedChapter: result.revisedChapter ?? undefined }
  },
}
