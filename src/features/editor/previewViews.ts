export type PreviewMode = 'page' | 'spread'

/** One screenful: the index of its first page and how many pages it shows (one, or two facing). */
export interface View {
  start: number
  count: number
}

/**
 * The screens of a preview. One page at a time, every page is its own screen.
 * As a bound book, the cover and the title page stand alone (each is a
 * right-hand page with nothing printed opposite) and the rest come in facing
 * pairs. A single-page project has no cover or title page, so it simply pairs.
 */
export function viewsFor(total: number, mode: PreviewMode, bound: boolean): View[] {
  if (mode === 'page') return Array.from({ length: total }, (_, start) => ({ start, count: 1 }))
  const views: View[] = []
  const alone = bound ? Math.min(2, total) : 0
  for (let start = 0; start < alone; start++) views.push({ start, count: 1 })
  for (let start = alone; start < total; start += 2) views.push({ start, count: Math.min(2, total - start) })
  return views
}

/** Which screen shows a page. */
export function viewIndex(views: View[], page: number): number {
  return Math.max(
    0,
    views.findIndex((view) => page >= view.start && page < view.start + view.count),
  )
}
