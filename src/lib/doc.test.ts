import { describe, expect, it } from 'vitest'
import { chapterNumbers, isContentsTitle } from './chapters'
import {
  buildChapterDoc,
  docText,
  docWordCount,
  listIllustrations,
  newIllustration,
  paragraphNode,
  paragraphsToNodes,
  patchIllustration,
} from './doc'

describe('buildChapterDoc', () => {
  it('places illustrations among the paragraphs, never before the first', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}.`)
    const doc = buildChapterDoc(paragraphs, [newIllustration({ prompt: 'a' }), newIllustration({ prompt: 'b' })])
    const types = (doc.content ?? []).map((node) => node.type)
    expect(types.filter((type) => type === 'paragraph')).toHaveLength(10)
    expect(types.filter((type) => type === 'illustration')).toHaveLength(2)
    expect(types[0]).toBe('paragraph')
    expect(listIllustrations(doc).map((ill) => ill.placement)).toEqual(['right', 'left'])
  })

  it('never returns an empty document', () => {
    expect(buildChapterDoc([], []).content).toEqual([{ type: 'paragraph' }])
  })
})

describe('document helpers', () => {
  const illustration = newIllustration({ prompt: 'a lighthouse' })
  const doc = buildChapterDoc(['One two three.', 'Four five.'], [illustration])

  it('reads plain text and counts words', () => {
    expect(docText(doc)).toBe('One two three.\n\nFour five.')
    expect(docWordCount(doc)).toBe(5)
    expect(docWordCount(null)).toBe(0)
  })

  it('patches one illustration without touching the original', () => {
    const next = patchIllustration(doc, illustration.id, { status: 'ready', src: 'x.png' })
    expect(listIllustrations(next)[0]).toMatchObject({ status: 'ready', src: 'x.png', prompt: 'a lighthouse' })
    expect(listIllustrations(doc)[0].status).toBe('empty')
  })
})

describe('paragraphsToNodes', () => {
  it('reads headings and lists from the markup importers leave', () => {
    const nodes = paragraphsToNodes(['## Basic', '1. Beloved Ancestors', '2. Changing Luck', '## WLS', '1. Peace', '- A bullet', 'Plain text.'])
    expect(nodes.map((node) => node.type)).toEqual(['heading', 'orderedList', 'heading', 'orderedList', 'bulletList', 'paragraph'])
    expect(nodes[0]).toEqual({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Basic' }] })
    expect(nodes[1].content).toHaveLength(2)
    expect(docText({ type: 'doc', content: nodes })).toContain('Beloved Ancestors')
  })

  it('keeps the page\'s own numbers and starts a new list when they restart', () => {
    const nodes = paragraphsToNodes(['16. Spirit', '17. Success Under Fire', '1. Wonderful Sex', '5. Out of order'])
    expect(nodes.map((node) => [node.attrs?.start, node.content?.length])).toEqual([
      [16, 2],
      [1, 1],
      [5, 1],
    ])
  })

  it('leaves ordinary sentences that begin with a number alone', () => {
    expect(paragraphsToNodes(['1984 was a hard year.', '12 people came.']).map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('keeps the lines of verse on separate lines', () => {
    expect(paragraphNode('O mighty Ancestors,\nGuardians and Guides')).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'O mighty Ancestors,' }, { type: 'hardBreak' }, { type: 'text', text: 'Guardians and Guides' }],
    })
  })

  it('can lead a list page with its illustration, centred', () => {
    const doc = buildChapterDoc(['## Basic', '1. One', '2. Two'], [newIllustration({ prompt: 'emblem' })], { lead: true })
    expect(doc.content?.[0].type).toBe('illustration')
    expect(doc.content?.[0].attrs?.placement).toBe('center')
    expect(doc.content?.map((node) => node.type)).toEqual(['illustration', 'heading', 'orderedList'])
  })
})

describe('chapter numbering', () => {
  it('numbers only the chapters that print a "Chapter N" line', () => {
    expect(chapterNumbers(['Table of Contents', 'Introduction', 'First Light', 'Chapter 2: The Moon', 'The Planets', 'Epilogue'])).toEqual([
      null,
      null,
      1,
      null,
      2,
      null,
    ])
  })

  it('recognises a chapter that is the table of contents', () => {
    expect(['Table of Contents', 'contents', ' Contents ', 'TABLE OF CONTENTS · I', 'Contents (continued)', 'Contents, Part Two'].map(isContentsTitle)).toEqual(
      [true, true, true, true, true, true],
    )
    expect(['Contents of the Chest', 'The Table', 'Index'].map(isContentsTitle)).toEqual([false, false, false])
  })
})
