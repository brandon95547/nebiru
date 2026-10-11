import { countWords, hashString, seededRandom, sleep } from '@/lib/util'
import type { BookPlan, ChapterDraft, PlannedChapter, TextService } from './types'

/**
 * Stand-in writing service used until the DeepSeek backend is connected.
 * It does real work where no language model is needed (planning from
 * imported chapters, laying out imported text, light cleanup) and returns
 * clearly marked placeholder prose everywhere else.
 */

const NOT_CONNECTED = 'The writing service is not connected yet, so this is a placeholder.'

const ARC = [
  'Beginnings',
  'First Steps',
  'A Wider World',
  'Complications',
  'The Turning Point',
  'Deeper Waters',
  'Setbacks',
  'What Was Hidden',
  'The Climb',
  'Resolution',
  'Aftermath',
  'Looking Ahead',
]

const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores.',
  'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit.',
  'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti.',
  'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates.',
]

function titleFromConcept(concept: string): string {
  const firstClause = concept.split(/[.!?\n]/)[0].trim()
  const words = firstClause.split(/\s+/).slice(0, 7)
  const title = words.join(' ').replace(/[,;:]+$/, '')
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Untitled Book'
}

function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30))}…`
}

function placeholderParagraphs(seed: number): string[] {
  const rand = seededRandom(seed)
  const count = 7 + Math.floor(rand() * 5)
  return Array.from({ length: count }, () => {
    const sentences = 3 + Math.floor(rand() * 4)
    return Array.from({ length: sentences }, () => LOREM[Math.floor(rand() * LOREM.length)]).join(' ')
  })
}

/** Whitespace and capitalisation cleanup that needs no language model. */
export function tidyText(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/([,;:!?])(?=[A-Za-z])/g, '$1 ')
    .replace(/\bi\b(?=[ ',.!?;:]|$)/g, 'I')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
    .trim()
}

function firstHalf(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*/g)
  if (!sentences || sentences.length < 2) return text
  return sentences
    .slice(0, Math.ceil(sentences.length / 2))
    .join('')
    .trim()
}

export const placeholderText: TextService = {
  async planBook(input): Promise<BookPlan> {
    await sleep(500)
    if (input.kind === 'concept') {
      const chapters: PlannedChapter[] = Array.from({ length: input.chapterCount }, (_, i) => ({
        title: ARC[i % ARC.length] + (i >= ARC.length ? ` ${Math.floor(i / ARC.length) + 1}` : ''),
        summary: 'Placeholder outline entry. The writing service will summarise this chapter from your concept.',
      }))
      return { title: titleFromConcept(input.concept), description: input.concept.trim(), chapters }
    }

    const { sources } = input
    const chapters: PlannedChapter[] = sources.flatMap((source) =>
      source.sections.map((section) => ({
        title: section.title ?? '',
        summary: excerpt(section.paragraphs.join(' '), 180),
        sourceSectionIds: [section.id],
      })),
    )
    chapters.forEach((chapter, i) => {
      if (!chapter.title) chapter.title = `Chapter ${i + 1}`
    })
    const first = sources[0]
    const words = sources.reduce((sum, s) => sum + s.wordCount, 0)
    const names = sources.map((s) => s.name).join(', ')
    return {
      title: first?.title || first?.name.replace(/\.[^.]+$/, '') || 'Untitled Book',
      description: `Built from ${names}: ${words.toLocaleString('en-US')} words in ${chapters.length} sections.`,
      chapters,
    }
  },

  async reviseOutline() {
    await sleep(400)
    return {
      chapters: null,
      reply: `${NOT_CONNECTED} Once it is running, instructions like this will rework the table of contents. Until then, edit the chapters directly.`,
    }
  },

  async writeChapter({ brief, chapterIndex, sourceParagraphs }): Promise<ChapterDraft> {
    await sleep(350)
    const chapter = brief.chapters[chapterIndex]
    const keepSource = brief.origin.kind === 'import' && brief.origin.mode === 'preserve'

    if (keepSource && sourceParagraphs.length > 0) {
      const words = countWords(sourceParagraphs.join(' '))
      const subject = excerpt(sourceParagraphs[0], 140)
      const prompts = [`${chapter.title}: ${subject}`]
      if (words > 2500) {
        prompts.push(`${chapter.title}: ${excerpt(sourceParagraphs[Math.floor(sourceParagraphs.length / 2)], 140)}`)
      }
      return { paragraphs: sourceParagraphs, illustrationPrompts: prompts }
    }

    const lead = `[Placeholder draft] ${NOT_CONNECTED} This chapter, “${chapter.title}”, will be written from its outline: ${chapter.summary || 'no summary yet.'}`
    return {
      paragraphs: [lead, ...placeholderParagraphs(hashString(brief.title + chapter.id))],
      illustrationPrompts: [`${chapter.title}: ${excerpt(chapter.summary || brief.description, 140)}`],
    }
  },

  async reviseText({ text, action }) {
    await sleep(300)
    if (action === 'grammar') {
      return { text: tidyText(text), note: 'Placeholder cleanup only: spacing and capitalisation.' }
    }
    if (action === 'shorten') {
      return { text: firstHalf(text), note: 'Placeholder shortening: kept the opening sentences.' }
    }
    return { text, note: `${NOT_CONNECTED} The text was left unchanged.` }
  },

  async chat({ brief }) {
    await sleep(400)
    return {
      reply: `${NOT_CONNECTED} When it is running, I will be able to discuss “${brief.title}” and apply the changes you ask for across its ${brief.chapters.length} chapters.`,
    }
  },
}
