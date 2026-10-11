import StarterKit from '@tiptap/starter-kit'
import { Illustration } from './illustrationNode'

/**
 * The schema of a chapter. Editors and static renders (thumbnails, preview)
 * share this one list so every surface understands the same document.
 */
export const bookExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    code: false,
    codeBlock: false,
    link: false,
    strike: false,
    dropcursor: { width: 2 },
  }),
  Illustration,
]
