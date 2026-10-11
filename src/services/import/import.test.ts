import { describe, expect, it } from 'vitest'
import { parseHtml } from './html'
import { importFile } from './index'
import { isHeadingLine, sectionize, sectionsFromBlocks } from './sections'
import { parseMarkdown, parsePlainText } from './text'

const prose = (label: string) => `${label} went on for a while, and then it kept going a little longer.`

describe('isHeadingLine', () => {
  it('recognises chapter markers', () => {
    for (const line of ['Chapter 1', 'CHAPTER XII', 'Chapter Twenty-One', 'Part Two: The Sea', 'Prologue', 'IV', '7.']) {
      expect(isHeadingLine(line), line).toBe(true)
    }
  })

  it('leaves ordinary prose alone', () => {
    for (const line of [
      'Chapter one of my life ended that day.',
      'Introduction to the subject was all he ever gave them,',
      'The part he played was small.',
      'It was the best of times.',
    ]) {
      expect(isHeadingLine(line), line).toBe(false)
    }
  })
})

describe('sectionize', () => {
  it('splits on headings and joins a subtitle to its chapter', () => {
    const sections = sectionize([
      'A note before the story.',
      'CHAPTER I',
      'Down the Rabbit-Hole',
      prose('Alice'),
      prose('The rabbit'),
      'CHAPTER II',
      prose('The pool'),
    ])
    expect(sections.map((s) => s.title)).toEqual([null, 'CHAPTER I: Down the Rabbit-Hole', 'CHAPTER II'])
    expect(sections[1].paragraphs).toHaveLength(2)
  })

  it('breaks a long run with no headings into parts', () => {
    const paragraph = Array.from({ length: 200 }, () => 'word').join(' ')
    const sections = sectionize(Array.from({ length: 40 }, () => paragraph))
    expect(sections.length).toBeGreaterThan(1)
    expect(sections[0].title).toBe('Part 1')
    expect(sections.flatMap((s) => s.paragraphs)).toHaveLength(40)
  })

  it('keeps a short run as one untitled section', () => {
    const sections = sectionize([prose('One'), prose('Two')])
    expect(sections).toEqual([{ title: null, paragraphs: [prose('One'), prose('Two')] }])
  })
})

describe('sectionsFromBlocks', () => {
  it('breaks on the shallowest repeated heading and keeps deeper ones as text', () => {
    const sections = sectionsFromBlocks([
      { kind: 'heading', level: 1, text: 'The Book' },
      { kind: 'heading', level: 2, text: 'First' },
      { kind: 'text', text: prose('A') },
      { kind: 'heading', level: 3, text: 'A detail' },
      { kind: 'text', text: prose('B') },
      { kind: 'heading', level: 2, text: 'Second' },
      { kind: 'text', text: prose('C') },
    ])
    expect(sections.map((s) => s.title)).toEqual(['First', 'Second'])
    expect(sections[0].paragraphs).toEqual([prose('A'), 'A detail', prose('B')])
  })
})

describe('parsePlainText', () => {
  it('rejoins hard-wrapped paragraphs', () => {
    const doc = parsePlainText('Chapter 1\r\n\r\nThe first line\r\nwraps onto a second.\r\n\r\nA new paragraph.')
    expect(doc.sections).toEqual([
      { title: 'Chapter 1', paragraphs: ['The first line wraps onto a second.', 'A new paragraph.'] },
    ])
  })
})

describe('parsePlainText title line', () => {
  it('takes a lone short opening line as the title', () => {
    const doc = parsePlainText('THE LIGHTHOUSE\n\nChapter 1\n\nFog.\n\nChapter 2\n\nRain.')
    expect(doc.title).toBe('THE LIGHTHOUSE')
    expect(doc.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('keeps longer front matter as its own section', () => {
    const doc = parsePlainText('A preface line.\n\nAnd a second one.\n\nChapter 1\n\nFog.')
    expect(doc.title).toBeUndefined()
    expect(doc.sections.map((s) => s.title)).toEqual([null, 'Chapter 1'])
  })
})

describe('parseMarkdown', () => {
  it('reads headings as sections and strips inline markup', () => {
    const doc = parseMarkdown('# My Book\n\n## One\nSome **bold** and _soft_ text\nacross lines.\n\n## Two\n\n- a [link](http://x.test)\n')
    expect(doc.title).toBe('My Book')
    expect(doc.sections).toEqual([
      { title: 'One', paragraphs: ['Some bold and soft text across lines.'] },
      { title: 'Two', paragraphs: ['a link'] },
    ])
  })
})

describe('parseHtml', () => {
  it('extracts readable text and skips page furniture', () => {
    const doc = parseHtml(`
      <html><head><title>A Tale</title><meta name="author" content="Jo Writer"><style>p{}</style></head>
      <body><nav>Menu</nav>
        <h2>Morning</h2><p>It was <em>early</em>.</p><div>Loose text<br><br>after a gap</div>
        <h2>Evening</h2><blockquote><p>Quoted.</p></blockquote><script>ignored()</script>
      </body></html>`)
    expect(doc.title).toBe('A Tale')
    expect(doc.author).toBe('Jo Writer')
    expect(doc.sections).toEqual([
      { title: 'Morning', paragraphs: ['It was early.', 'Loose text', 'after a gap'] },
      { title: 'Evening', paragraphs: ['Quoted.'] },
    ])
  })
})

describe('importFile', () => {
  it('turns a text file into source material', async () => {
    const file = new File(['Chapter 1\n\nHello there, reader.\n\nChapter 2\n\nGoodbye for now.'], 'story.txt', { type: 'text/plain' })
    const outcome = await importFile(file)
    expect(outcome.status).toBe('parsed')
    if (outcome.status !== 'parsed') return
    expect(outcome.document.format).toBe('TXT')
    expect(outcome.document.wordCount).toBe(6)
    expect(outcome.document.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('reports formats that wait on a backend service', async () => {
    const audio = await importFile(new File(['x'], 'talk.mp3', { type: 'audio/mpeg' }))
    const kindle = await importFile(new File(['x'], 'novel.mobi'))
    expect(audio.status).toBe('needs-service')
    expect(kindle.status).toBe('needs-service')
  })

  it('rejects a file with no text', async () => {
    const outcome = await importFile(new File(['   \n\n  '], 'blank.txt', { type: 'text/plain' }))
    expect(outcome.status).toBe('error')
  })
})
