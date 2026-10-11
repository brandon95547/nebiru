/** How a chapter's title decides its place in the book's furniture. */

const CONTENTS = /^(?:table of )?contents\b(.*)$/i
/** What may follow "Contents" on a page that continues it: "II", "2", "(continued)", "· Part Two". */
const CONTINUATION = /\b(?:[ivxlc]+|part|page|continued|cont|one|two|three|four|five)\b/gi
const UNNUMBERED =
  /^(?:(?:table of )?contents|index|prologue|epilogue|introduction|preface|foreword|afterword|appendix|conclusion|dedication|acknowledge?ments|about the author|glossary|bibliography)\b/i
const NUMBERS_ITSELF = /^(?:chapter|part|book)\b/i

/** A chapter that is itself the book's table of contents, e.g. one imported from a photo of it. */
export function isContentsTitle(title: string): boolean {
  const match = CONTENTS.exec(title.trim())
  // "Contents · II" is a contents page; "Contents of the Chest" is a chapter.
  return match !== null && !/[a-z]{2,}/i.test(match[1].replace(CONTINUATION, ''))
}

/** Whether the layout prints a "Chapter N" line above this title. */
export function takesChapterNumber(title: string): boolean {
  const trimmed = title.trim()
  return !UNNUMBERED.test(trimmed) && !NUMBERS_ITSELF.test(trimmed)
}

/** The number printed above each chapter, or null where it has none. Front and back matter is not counted. */
export function chapterNumbers(titles: string[]): Array<number | null> {
  let count = 0
  return titles.map((title) => (takesChapterNumber(title) ? ++count : null))
}
