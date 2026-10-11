import { describe, expect, it } from 'vitest'
import { buildChapterDoc, docText, docWordCount, listIllustrations, newIllustration, patchIllustration } from './doc'

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
