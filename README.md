# Nebiru

An AI-powered studio for creating illustrated books: plan a book from an idea or
from imported material, have it written and illustrated, then edit every page in
a visual, print-accurate editor.

The app is React + TypeScript + Tailwind CSS v4, built with Vite. A small FastAPI
server (`server/`) puts DeepSeek behind the writing features and ComfyUI behind
illustration.

## Status

Writing and illustration switch on independently, each as soon as the server
reports it ready. Whatever is not ready runs on a built-in stand-in, and a badge
in the header says so ("Placeholder art", "Placeholder writing", "Placeholder AI").
With no server at all the app still works end to end on stand-ins.

| Area | State |
| --- | --- |
| Library, project save/open | Working. Books persist in IndexedDB; project files download as `.nebiru.json` |
| Import: EPUB, PDF, DOCX, TXT, Markdown, HTML | Working, parsed in the browser |
| Import: MOBI/AZW, audio, video | Recognised, but waiting on backend conversion/transcription |
| Planning, conversational outline edits | Working with DeepSeek |
| Chapter writing, per-chapter regeneration, adaptation of imported material | Working with DeepSeek |
| Grammar, rewrite, expand, shorten, restyle; assistant chat that can rewrite the open chapter | Working with DeepSeek |
| Illustrations and cover, per-image regeneration | Built for ComfyUI and covered by tests against a simulated ComfyUI; not yet run against a real one |
| Visual editor: pages, text flow, illustrations, thumbnails, preview | Working |
| Export to PDF and EPUB | Not built yet |

## Run it

The app:

```bash
npm install
npm run dev            # http://localhost:5199
```

The server, in a second terminal:

```bash
npm run server:setup   # once: creates server/.venv and installs dependencies
cp server/.env.example server/.env   # once: then fill in DEEPSEEK_API_KEY
npm run server         # http://127.0.0.1:8787, proxied by the app at /api
```

Checks:

```bash
npm run typecheck
npm test
npm run server:test
npm run build
```

Node 24 (see `.nvmrc`), Python 3.11 or newer.

### Server settings

Everything is in `server/.env` (see `server/.env.example`; the file itself is not
committed).

- **DeepSeek** needs `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL`. The model name has no
  built-in default on purpose, so a retired name is fixed in `.env` and not in code.
- **ComfyUI** needs `COMFYUI_URL` (default `http://127.0.0.1:8188`). Nebiru uses a
  checkpoint ComfyUI already has: `COMFYUI_CHECKPOINT`, or the first one installed.
  It never downloads a model. Set `COMFYUI_BASE_SIZE` to 512 for SD 1.5 checkpoints.
- The built-in workflow is plain text-to-image, which suits SD 1.5 and SDXL. For
  anything else (Flux, LoRAs, upscaling) export your own workflow from ComfyUI in
  API format and point `COMFYUI_WORKFLOW` at it; the tokens it can use are listed
  in `.env.example`.

Failures from either provider are reported in the app as failures, with the
provider's reason. They are never replaced by stand-in output.

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
    text/              TextService interface; DeepSeek-backed and placeholder implementations
    illustration/      IllustrationService interface; ComfyUI-backed and placeholder implementations
    import/            File parsers and chapter detection
    generation.ts      Orchestrates writing and illustrating a book
    api.ts             Calls to the server
  features/
    dashboard/         Library
    create/            New book: from an idea or from imported files
    plan/              Title, description, table of contents, styles, approval
    editor/            The visual book editor
  components/          Shared UI
  styles/book.css      Typography of the printed page

server/
  app/
    main.py            FastAPI app and routes (all under /api)
    deepseek.py        DeepSeek client: retries, truncation handling, error mapping
    prompts.py         Every prompt sent to the writing model
    text_service.py    Planning, chapter writing, revision, chat
    comfy.py           ComfyUI client and the built-in workflow
    styles.py          The prompt language behind each illustration style
    schemas.py         Request and response shapes
  tests/               Run against fake DeepSeek and ComfyUI servers; no network needed
```

### How the AI services are wired

Screens never import a concrete AI implementation. They call `services.text` and
`services.illustration` from `src/services/index.ts`, typed by `TextService`
(`services/text/types.ts`) and `IllustrationService`
(`services/illustration/types.ts`). At startup, and whenever the tab regains
focus, the app asks the server's `/api/status` which services are ready and
points each one at its live or stand-in implementation.

Generated images are stored by the server under `server/data/images` and
referenced from the book by URL, so a downloaded project file does not carry
its pictures with it.

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
