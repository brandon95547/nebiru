# Nebiru

An AI-powered studio for creating illustrated books: plan a book from an idea or
from imported material, have it written and illustrated, then edit every page in
a visual, print-accurate editor.

React + TypeScript + Tailwind CSS v4, built with Vite. Text generation is designed
for DeepSeek and illustration for ComfyUI, both behind a backend service.

## Status

The interface and project workflow are in place and run entirely in the browser.
**The AI services are not connected yet**: writing and illustration go through
built-in placeholder services, so imported text is laid out for real while
generated prose and artwork are stand-ins. The app shows a "Placeholder AI" badge
while this is the case.

| Area | State |
| --- | --- |
| Library, project save/open | Working. Books persist in IndexedDB; project files download as `.nebiru.json` |
| Import: EPUB, PDF, DOCX, TXT, Markdown, HTML | Working, parsed in the browser |
| Import: MOBI/AZW, audio, video | Recognised, but waiting on backend conversion/transcription |
| Table-of-contents planning and approval | Working; conversational edits need the writing service |
| Chapter writing, per-chapter regeneration | Workflow working; prose is placeholder unless the source text is kept |
| Illustrations and cover, per-image regeneration | Workflow working; artwork is placeholder |
| Visual editor: pages, text flow, illustrations, thumbnails, preview | Working |
| Export to PDF and EPUB | Not built yet |

## Run it

```bash
npm install
npm run dev        # http://localhost:5199
```

```bash
npm run typecheck
npm test
npm run build
```

Node 24 (see `.nvmrc`).

## How it is organised

```
src/
  types.ts             Domain model: Book, Chapter, PageSettings, illustrations
  lib/                 Pure helpers: page geometry, trim sizes, fonts, chapter documents
  store/
    library.ts         All books, in memory and mirrored to IndexedDB
    editorHub.ts       Registry of live chapter editors
  services/
    index.ts           The one place AI services are chosen
    text/              TextService interface + placeholder implementation
    illustration/      IllustrationService interface + placeholder implementation
    import/            File parsers and chapter detection
    generation.ts      Orchestrates writing and illustrating a book
  features/
    dashboard/         Library
    create/            New book: from an idea or from imported files
    plan/              Title, description, table of contents, styles, approval
    editor/            The visual book editor
  components/          Shared UI
  styles/book.css      Typography of the printed page
```

### Connecting DeepSeek and ComfyUI

Screens never import a concrete AI implementation. They call `services.text` and
`services.illustration` from `src/services/index.ts`, typed by `TextService`
(`services/text/types.ts`) and `IllustrationService`
(`services/illustration/types.ts`). Connecting the real models means writing
implementations of those two interfaces that call the backend, and selecting
them in `services/index.ts`. No screen changes.

### How pages are laid out

Each chapter's text sits in a single CSS multi-column box whose columns are
exactly one page's text block, spaced so every column lands on its own sheet
(`features/editor/BookStrip.tsx`). The browser does the pagination: text flows
between pages, wraps around floated illustrations and splits paragraphs at page
ends, while the chapter stays one editable Tiptap document. Chapters near the
viewport get a live editor; the rest, the thumbnails and the preview render the
same document as static HTML with identical layout.

Colours are all Tailwind palette steps, aliased to semantic tokens in
`src/index.css`.
