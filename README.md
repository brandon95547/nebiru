# Nebiru

An AI-powered studio for creating illustrated books: plan a book from an idea or
from imported material, have it written and illustrated, then edit every page in
a visual, print-accurate editor.

Nebiru runs as one Docker Compose application:

- **nebiru** — the web app and its API in a single container. Writing goes
  through DeepSeek.
- **comfyui** — ComfyUI running **FLUX.1 Dev (quantized GGUF)** for
  illustrations and covers. It is built, configured and given its model files
  automatically; you never set ComfyUI up by hand.

## Install

You need Docker with Compose v2.20 or newer. For illustrations you also need an
NVIDIA GPU with the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
installed. Without a GPU Nebiru still runs; illustrations use placeholder art.

```bash
git clone git@github.com:brandon95547/nebiru.git
cd nebiru
./nebiru start
```

`./nebiru start` does everything on the first run:

1. Creates `.env` from `.env.example`.
2. Looks at your GPU and picks the FLUX.1 Dev quantization that fits its memory.
3. Asks for your DeepSeek API key (you can skip it and add it to `.env` later).
4. Builds the two images and starts them.

Then open **http://127.0.0.1:8787**.

The first start downloads the FLUX model files, about 12 to 18 GB depending on
the quantization. The app is usable straight away: until the download finishes,
the badge in the header reads "Placeholder art" and its tooltip shows the
progress. Later starts need no network for the models.

```bash
./nebiru status    # what is running, and which AI features are ready
./nebiru logs      # follow the logs (./nebiru logs comfyui for the download)
./nebiru stop      # stop; your data stays
./nebiru update    # pull the latest version and restart
```

The script is a convenience. Plain Compose works too:

```bash
cp .env.example .env     # then edit it
docker compose up -d --build
```

## Your data

Everything that must last is in one folder, `./data` by default (`NEBIRU_DATA`):

| Folder | Holds |
| --- | --- |
| `data/nebiru/books` | Every book project, one JSON file each |
| `data/nebiru/images` | Generated illustrations and covers |
| `data/models` | The FLUX model files |
| `data/comfyui` | ComfyUI's own output, settings and logs |

Containers and images can be removed and rebuilt at any time without touching
it. To back up, or to move Nebiru to another machine, copy `data/` and `.env`.
Files in it belong to the user who ran `./nebiru setup`, not to root.

## Settings

All in `.env`; `.env.example` documents each one. The ones you are most likely
to change:

| Setting | What it does |
| --- | --- |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | Required for the writing features |
| `FLUX_QUANT` | Which FLUX.1 Dev quantization to use: `Q4_K_S` (8 GB cards), `Q5_K_S`, `Q6_K`, `Q8_0` (16 GB and up). Change it and restart to fetch another |
| `FLUX_STEPS`, `FLUX_GUIDANCE`, `FLUX_SIZE` | Sampling steps, prompt strength and image size |
| `NEBIRU_PORT`, `NEBIRU_BIND` | Where the app listens. It binds to `127.0.0.1` by default |
| `NEBIRU_DATA` | Where the data folder is |
| `COMPOSE_PROFILES` | `art` runs ComfyUI; empty runs Nebiru without it |
| `COMFYUI_REF`, `COMFYUI_GGUF_REF`, `TORCH_INDEX_URL` | Pinned versions of ComfyUI, the GGUF loader and the PyTorch build |

After changing `.env`, run `./nebiru start` again.

**Nebiru has no login.** It listens only on this machine unless you set
`NEBIRU_BIND=0.0.0.0`; do that only behind a reverse proxy or VPN that adds
access control, because anyone who can reach it can use your DeepSeek key.

Other things worth knowing:

- **No NVIDIA GPU.** `./nebiru setup` leaves ComfyUI switched off. To run it on
  the CPU anyway (many minutes per picture; for testing only), set
  `COMPOSE_PROFILES=art` and
  `COMPOSE_FILE=docker-compose.yml:docker-compose.cpu.yml`.
- **Your own model files.** Set `NEBIRU_SKIP_MODEL_DOWNLOAD=1` and put them
  under `data/models/` in `diffusion_models/`, `text_encoders/` and `vae/`.
- **Your own workflow.** Export one from ComfyUI in API format, save it under
  `data/nebiru/`, and set `COMFYUI_WORKFLOW=/data/your-workflow.json`. The
  tokens it can use are listed in `server/.env.example`.
- **Model licence.** FLUX.1 Dev is released under Black Forest Labs'
  non-commercial licence. Check its terms before selling books illustrated
  with it.

Failures from DeepSeek or ComfyUI are shown in the app as failures, with the
provider's reason. They are never replaced by stand-in output.

## What works

| Area | State |
| --- | --- |
| Library; books saved on the server | Working |
| Import: EPUB, PDF, DOCX, TXT, Markdown, HTML | Working, parsed in the browser |
| Import: MOBI/AZW, audio, video | Recognised, but conversion and transcription are not built |
| Planning, conversational outline edits | Working with DeepSeek |
| Chapter writing, per-chapter regeneration, adaptation of imported material | Working with DeepSeek |
| Grammar, rewrite, expand, shorten, restyle; assistant chat that can rewrite the open chapter | Working with DeepSeek |
| Illustrations and covers with FLUX.1 Dev | Built and tested up to the model itself: the stack starts, ComfyUI accepts the FLUX workflow, the downloader works. Not yet run on a GPU with the real model files |
| Visual editor: pages, text flow, illustrations, thumbnails, preview | Working |
| Export to PDF and EPUB | Not built yet |

## Development

To work on Nebiru without Docker:

```bash
npm install
npm run dev            # the app, http://localhost:5199
```

```bash
npm run server:setup   # once: creates server/.venv
cp server/.env.example server/.env   # once: then fill in DEEPSEEK_API_KEY
npm run server         # the API, http://127.0.0.1:8787, proxied by the app at /api
```

Development reads `server/.env`, not the root `.env`, and expects you to point
`COMFYUI_URL` at a ComfyUI of your own. With no server running the app still
works end to end on built-in stand-ins, and keeps books in the browser.

```bash
npm run typecheck
npm test
npm run server:test
npm run build
```

Node 24 (see `.nvmrc`), Python 3.11 or newer.

### How it is organised

```
src/
  types.ts             Domain model: Book, Chapter, PageSettings, illustrations
  lib/                 Pure helpers: page geometry, trim sizes, fonts, chapter documents
  store/
    library.ts         All books, in memory, saved as they change
    persistence.ts     Where books are kept: the server, or the browser without one
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
    main.py            FastAPI app and routes (all under /api); serves the built web app
    deepseek.py        DeepSeek client: retries, truncation handling, error mapping
    prompts.py         Every prompt sent to the writing model
    text_service.py    Planning, chapter writing, revision, chat
    comfy.py           ComfyUI client and the built-in workflows (FLUX, checkpoint)
    styles.py          The prompt language behind each illustration style
    library.py         Book storage
    downloads.py       Reads the model download's progress
    schemas.py         Request and response shapes
  tests/               Run against fake DeepSeek and ComfyUI servers; no network needed

Dockerfile             The application image: builds the web app, adds the server
docker/comfyui/        The ComfyUI image, its entrypoint and the model downloader
docker-compose.yml     The whole application
nebiru                 Install and management script
```

### How the AI services are wired

Screens never import a concrete AI implementation. They call `services.text` and
`services.illustration` from `src/services/index.ts`. At startup, and whenever
the tab regains focus, the app asks the server's `/api/status` which services
are ready and points each one at its live or stand-in implementation, so
writing and illustration switch on independently.

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
