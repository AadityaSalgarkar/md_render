---
name: mdrender
description: Render markdown for a human using MD_RENDER — open files in the desktop app, or serve them as browser tabs over HTTP from any machine, including headless ones, and drive the served tabs through its MCP server. Use when asked to preview, render, or "open" a markdown file, to make markdown on a remote host readable locally, or to open, close, focus or comment on documents the human is reading.
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

A URL works wherever a path does, in both modes:

```bash
mdrender https://github.com/anthropics/skills/blob/main/README.md
mdrender --port https://raw.githubusercontent.com/o/r/main/docs/guide.md
```

The document is downloaded under `/tmp/md-render/remote` (GitHub file pages
as their raw content; files of one repository share one directory, so they
share one workspace named `github.com-OWNER-REPO`) and opened from there.
Naming the URL again re-opens the same tab; a refresh downloads it again.
Saving an edit to a remote document also keeps a copy under
`~/.config/mdrender/temp_files/` (same layout; `MDRENDER_SAVED_DIR`
overrides), and that copy is what opens and what a refresh restores from
then on — delete it to get back to upstream. Relative images inside a remote
document do not resolve.

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
(`mdrender --port extra.md`, or `mdrender extra.md` for the window), or with
the MCP `open_tab` tool, which also keeps it in its original workspace.

## Driving the server from an agent (MCP)

`mdrender --mcp` is an MCP server over stdio. Register it once
(`claude mcp add mdrender -- mdrender --mcp`, or `.mcp.json` with
`{"command": "mdrender", "args": ["--mcp"]}`) and use its tools instead of
shelling out; every result carries the URL to give the human, and an open
browser follows within about 3 seconds.

| Need | Tool |
|---|---|
| Which servers are running, on which ports | `list_servers` |
| Serve files/directories/URLs (or add to a live server) | `start_server {paths, port?, host?}` |
| Stop a server | `stop_server {port}` |
| Workspaces and their URLs | `list_workspaces`, `open_directory {path}`, `close_workspace {workspace}` |
| Tabs | `list_tabs {workspace?}`, `open_tab {path, workspace?}` (path may be a URL), `close_tab {id \| path}`, `refresh {workspace?}` |
| Content | `read_document {id \| path}`, `write_document {path, content}` |
| Review | `add_comment {path, passage, comment}`, `export_clean {path}` |
| The reader's browser | `focus_tab {id \| path}`, `set_theme {theme, workspace?}` |

`port` is optional everywhere: with one live server it is inferred, with
several the error lists them. `open_tab` puts a file back into the most
specific workspace that contains it (a closed `docs/guide/setup.md` returns
to `docs` as `guide/setup.md`). `write_document` and `add_comment` only touch
files that are open as tabs; an open browser re-reads a changed file within
30 seconds unless it holds unsaved edits, and `focus_tab` makes it reload at
once. `set_theme` accepts `warm-paper`, `midnight-ink`, `newsprint`,
`forest`, `nocturne`, `evergreen`.

### Without MCP: the HTTP API

The server also answers plain HTTP on its port:

```bash
curl http://127.0.0.1:9999/api/health         # {"app":"md-render",...}
curl http://127.0.0.1:9999/api/workspaces     # workspace names and dirs
curl http://127.0.0.1:9999/api/files          # tab list with ids and workspace (?ws= scopes, ?refresh=true rescans)
curl http://127.0.0.1:9999/api/file?id=0      # one document's content
curl "http://127.0.0.1:9999/api/view?ws=docs" # what the workspace's pages should show
```

Mutations need `Authorization: Bearer <token>` with the token from
`$XDG_STATE_HOME/md-render/servers/<port>.json` (falls back to
`~/.local/state/...`, mode 0600, so only same-user processes can read it):
`PUT /api/file {path, content}`, `POST /api/documents {paths, ws?}`,
`DELETE /api/file?id=N`, `DELETE /api/workspaces?name=X`,
`PUT /api/view {ws, doc?, theme?}`, `POST /api/export {path, content}`,
`POST /api/shutdown`.

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
