import { countWords, uid } from '@/lib/util'
import type { SourceDocument } from '@/types'
import { parseHtml } from './html'
import { parseMarkdown, parsePlainText } from './text'
import type { ImportOutcome, ParsedDocument } from './types'

/** Reads a user's file into source material. Parsing happens in the browser. */

const KINDLE = new Set(['mobi', 'azw', 'azw3', 'kfx', 'prc'])
const OTHER_DOCS = new Set(['doc', 'rtf', 'odt', 'pages', 'fb2', 'djvu'])
const MEDIA = new Set([
  'mp3', 'm4a', 'm4b', 'wav', 'ogg', 'oga', 'flac', 'aac', 'opus', 'wma',
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv',
])

/** Everything the file picker should offer. */
export const ACCEPTED_EXTENSIONS = [
  'epub', 'pdf', 'docx', 'txt', 'md', 'html', 'htm',
  ...KINDLE,
  ...MEDIA,
]

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isMediaFile(file: File): boolean {
  return MEDIA.has(fileExtension(file.name)) || /^(audio|video)\//.test(file.type)
}

async function parse(file: File, ext: string): Promise<ParsedDocument | null> {
  switch (ext) {
    case 'txt':
    case 'text':
      return parsePlainText(await file.text())
    case 'md':
    case 'markdown':
      return parseMarkdown(await file.text())
    case 'html':
    case 'htm':
    case 'xhtml':
      return parseHtml(await file.text())
    case 'docx':
      return (await import('./docx')).parseDocx(await file.arrayBuffer())
    case 'epub':
      return (await import('./epub')).parseEpub(await file.arrayBuffer())
    case 'pdf':
      return (await import('./pdf')).parsePdf(await file.arrayBuffer())
    default:
      return file.type.startsWith('text/') ? parsePlainText(await file.text()) : null
  }
}

export async function importFile(file: File): Promise<ImportOutcome> {
  const ext = fileExtension(file.name)

  if (isMediaFile(file)) {
    return { status: 'needs-service', reason: 'Audio and video are transcribed by the media service, which is not connected yet.' }
  }
  if (KINDLE.has(ext) || OTHER_DOCS.has(ext)) {
    return { status: 'needs-service', reason: `.${ext} files are converted by the import service, which is not connected yet.` }
  }

  try {
    const parsed = await parse(file, ext)
    if (!parsed) return { status: 'error', reason: `Nebiru cannot read .${ext || 'this kind of'} files.` }

    const sections = parsed.sections.map((section) => ({ id: uid('sec'), ...section }))
    const wordCount = sections.reduce((sum, s) => sum + countWords(s.paragraphs.join(' ')), 0)
    if (wordCount === 0) return { status: 'error', reason: 'No readable text was found in this file.' }

    const document: SourceDocument = {
      id: uid('src'),
      name: file.name,
      format: ext.toUpperCase() || 'TEXT',
      title: parsed.title,
      author: parsed.author,
      wordCount,
      sections,
    }
    return { status: 'parsed', document }
  } catch (error) {
    return { status: 'error', reason: error instanceof Error ? error.message : 'The file could not be read.' }
  }
}
