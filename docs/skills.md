---
name: mdrender
description: Render markdown for a human using MD_RENDER — open files in the desktop app, or serve them as browser tabs over HTTP from any machine, including headless ones. Use when asked to preview, render, or "open" a markdown file, or to make markdown on a remote host readable locally.
---

# Rendering markdown with MD_RENDER

MD_RENDER displays markdown with book typography: themes, a heading index,
KaTeX math, Mermaid diagrams, highlighted code, and review comments. One
binary, two modes — a desktop window and an HTTP server with the same
capabilities. The CLI entry point is the `mdrender` wrapper (usually on PATH
at `~/bin/mdrender`).

## Open files in the desktop window

```bash
mdrender notes.md               # one file
mdrender a.md b.md ./docs       # several files and a directory -> tabs
```

Directory arguments contribute every `.md`/`.markdown` beneath them. The
command returns immediately; the window opens detached.

## Serve to a browser (works headless)

```bash
mdrender --port notes.md ./docs     # default port 9999 (auto-falls forward)
mdrender --port 8080 notes.md       # explicit port (1-65535)
```

Each directory (or a file's parent directory) becomes a workspace at
`http://127.0.0.1:9999/<dirname>/` with its own tab set. This prints the
workspace URLs and blocks until ctrl-c — run it in the background if you
need your shell back. No display is required, so it works on servers; the
human reads it through an SSH forward:

```bash
ssh -L 9999:127.0.0.1:9999 host   # run on the human's machine
```

**Adding tabs:** running `mdrender --port extra.md` while a server already
holds the port does not fail — it hands `extra.md` to the running server as a
new tab and exits. Open browsers pick it up within a few seconds.

**Closing tabs:** every tab has a ✕ in the strip (window and browser alike).
A closed file does not come back on refresh; re-open it by naming it again
(`mdrender --port extra.md`, or `mdrender extra.md` for the window).

## Reading served documents programmatically

The server exposes a small JSON API on its port:

```bash
curl http://127.0.0.1:9999/api/health         # {"app":"md-render",...}
curl http://127.0.0.1:9999/api/workspaces     # workspace names and dirs
curl http://127.0.0.1:9999/api/files          # tab list with ids (?ws= scopes)
curl http://127.0.0.1:9999/api/file?id=0      # one document's content
```

Writing (`PUT /api/file`, `POST /api/documents`, and `DELETE /api/file?id=N`
to close a tab) requires the bearer token
from `$XDG_STATE_HOME/md-render/servers/<port>.json` (falls back to
`~/.local/state/...`). Only same-user processes can read it. Prefer editing
files on disk directly; the app refreshes from disk on its 30-second sync.

## Quiz blocks

When generating study or review material, this markup renders as a quiz card
whose options stay hidden until the reader clicks the eye button:

```html
<quiz>Which planet is largest?
<enumerate>
<option>Mars</option>
<option>Jupiter</option>
</enumerate>
<answer>Jupiter — by a wide margin.</answer>
</quiz>
```

The `<answer>` stays hidden until the reader clicks "Show answer" —
independently of the options — and also works standalone outside a quiz.

## Review comments

Comments are stored inline in the markdown as
`<chat><comment>...</comment></chat>` blocks after the passage they discuss.
To read a document without them, strip those blocks — or use the app's
"Export clean .md", which writes `NAME.clean.md` beside the file.

## Notes

- Ports outside 1–65535 are rejected with an error (there is no clamping).
- The server binds `127.0.0.1` by default; `--host 0.0.0.0` exposes file
  contents and editing to the network — do not pass it unless the human
  asked.
- The server reads and writes only the documents it was told to open;
  images only from those documents' directories.
- If `mdrender` is missing, install from the repo:
  `git clone https://github.com/AadityaSalgarkar/md_render && cd md_render && npm install && make install`
