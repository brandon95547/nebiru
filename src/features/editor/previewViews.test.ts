import { describe, expect, it } from 'vitest'
import { viewIndex, viewsFor } from './previewViews'

describe('viewsFor', () => {
  it('gives every page its own screen, one page at a time', () => {
    expect(viewsFor(3, 'page', true)).toEqual([
      { start: 0, count: 1 },
      { start: 1, count: 1 },
      { start: 2, count: 1 },
    ])
  })

  it('shows a bound book as cover, title page, then facing pairs', () => {
    expect(viewsFor(7, 'spread', true)).toEqual([
      { start: 0, count: 1 },
      { start: 1, count: 1 },
      { start: 2, count: 2 },
      { start: 4, count: 2 },
      { start: 6, count: 1 },
    ])
  })

  it('pairs the sheets of a single-page project from the first', () => {
    expect(viewsFor(3, 'spread', false)).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 1 },
    ])
  })

  it('has nothing to show before the pages are measured', () => {
    expect(viewsFor(0, 'spread', true)).toEqual([])
  })
})

describe('viewIndex', () => {
  const views = viewsFor(7, 'spread', true)

  it('finds the screen a page is on, whichever side of the pair', () => {
    expect(viewIndex(views, 2)).toBe(2)
    expect(viewIndex(views, 3)).toBe(2)
    expect(viewIndex(views, 6)).toBe(4)
  })

  it('falls back to the first screen for a page that is not there', () => {
    expect(viewIndex(views, 40)).toBe(0)
  })
})
