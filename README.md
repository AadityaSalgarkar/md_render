# MD_RENDER

[![ci](https://github.com/AadityaSalgarkar/md_render/actions/workflows/ci.yml/badge.svg)](https://github.com/AadityaSalgarkar/md_render/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/AadityaSalgarkar/md_render?sort=semver)](https://github.com/AadityaSalgarkar/md_render/releases/latest)

Markdown, set like a book. A renderer for macOS and Linux built on Tauri 2 —
six typographic themes, a document index, math, Mermaid, review comments, and
a server mode that puts the same app in your browser over SSH.

```bash
curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | sh
```

**[Documentation](https://aadityasalgarkar.github.io/md_render/)** ·
[llms.txt](https://aadityasalgarkar.github.io/md_render/llms.txt) ·
[skills.md](https://aadityasalgarkar.github.io/md_render/skills.md)

![MD_RENDER serving three documents as browser tabs, with the index, math, highlighted code and a Mermaid diagram](docs/assets/browser.png)

## Features

- Six typographic themes — three light (Warm Paper, Newsprint, Forest), three
  dark (Midnight Ink, Nocturne, Evergreen) — each with its own faces, colors,
  and code palette
- Collapsible document index built from headings, with scroll-spy and a
  reading-progress bar
- Several files open as tabs, in the window or in the browser, each closable
  from the strip; a refresh control picks up markdown added to a directory
  after launch, and a closed tab stays closed until the file is opened again
- GitHub-flavored markdown, KaTeX math, Mermaid diagrams, highlighted code,
  local images resolved relative to the file
- Split-pane editor with save, 30-second autosave, and save-on-close
- Review comments attached to selected passages, stored in the markdown
  itself, with clean export (`notes.md` → `notes.clean.md`)
- Quiz blocks: `<quiz>question <enumerate><option>…</option></enumerate></quiz>`
  renders a card whose options stay hidden until the eye button reveals them;
  an `<answer>…</answer>` inside (or anywhere) stays hidden until clicked
- Server mode with full parity: editing and saving work in the browser too
- An MCP server (`mdrender --mcp`) so agents can start and stop servers,
  open and close workspaces and tabs, read, write, comment on and export
  documents, and focus a tab or switch the theme in the reader's browser

## Install

One line — detects the platform, checks prerequisites, clones and runs
`make install` (no sudo; it stops with instructions if build tools are
missing):

```bash
curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | sh
```

Or grab a build from
[Releases](https://github.com/AadityaSalgarkar/md_render/releases/latest) —
dmg for macOS; deb, rpm or AppImage for Linux. The macOS builds are unsigned:
right-click → Open the first time (or
`xattr -d com.apple.quarantine /Applications/MD_RENDER.app`).

Or by hand:

```bash
git clone https://github.com/AadityaSalgarkar/md_render
cd md_render
npm install
make install
```

`make install` detects the platform. On macOS it installs `MD_RENDER.app` and
the `~/bin/mdrender` wrapper; on Linux everything lands under `~/.local` and
`~/bin` — no root. Linux needs the webkit2gtk build deps, and both need Rust
and Node; see the
[install docs](https://aadityasalgarkar.github.io/md_render/#install) for the
package list, `PREFIX=`, and the deb/rpm/AppImage bundles.

To make it the macOS default for markdown:
`brew install duti && duti -s com.mdrender.app .md all`

## Use

```bash
mdrender                    # open the app
mdrender notes.md           # open one file
mdrender a.md b.md ./docs   # several files and a directory — tabs
mdrender --port notes.md    # serve to a browser instead
mdrender --mcp              # MCP server over stdio, for agents
```

Directory arguments contribute every markdown file beneath them. The window
and the server take the same arguments and open the same tabs.

## Server mode

```
$ mdrender --port notes.md ./docs
serving 4 files on http://127.0.0.1:9999
  http://127.0.0.1:9999/project/
    notes.md
  http://127.0.0.1:9999/docs/
    api.md
    guide/setup.md
    guide/usage.md
(ctrl-c to stop)
```

The port defaults to 9999, falling forward to the next free port when
another program holds it (`--port 8080` pins one). Each directory — or a
file's parent directory — becomes a workspace at
`http://127.0.0.1:9999/<dirname>/` with its own tabs; the root URL redirects
to the only workspace, or lists them all. Everything works as in the window,
including editing and saving back to disk. Running the command again while a
server holds the port adds the files as tabs (and new directories as
workspaces) instead of failing.

Reading a document on a headless machine — the reason the mode exists:

```bash
ssh -L 9999:127.0.0.1:9999 my-server
mdrender --port ~/notes.md           # on the server
```

The server binds loopback by default, reads and writes only the documents it
was told to open, serves images only from their directories, and gates every
write behind a token injected into the page it serves. Details in the
[security notes](https://aadityasalgarkar.github.io/md_render/#security).

## Claude Code integration

MD_RENDER ships an MCP server that drives the `--port` mode, so an agent can
do everything a reader does by hand in the browser. Register it once:

```bash
claude mcp add mdrender -- mdrender --mcp
```

or in a project's `.mcp.json`:

```json
{ "mcpServers": { "mdrender": { "command": "mdrender", "args": ["--mcp"] } } }
```

Tools: `list_servers`, `start_server`, `stop_server`; `list_workspaces`,
`open_directory`, `close_workspace`; `list_tabs`, `open_tab`, `close_tab`,
`refresh`; `read_document`, `write_document`, `add_comment`, `export_clean`;
`focus_tab`, `set_theme`. Every result names the URL to hand the human, and
an open browser follows within a few seconds — a tab the agent opens
appears, a tab it focuses comes to the front. `make install` puts the
bundled server at `~/.local/share/md-render/mcp/index.js`; it needs `node`.

A PostToolUse hook can also open plan files in the desktop window the moment
Claude Code writes them, and
[skills.md](https://aadityasalgarkar.github.io/md_render/skills.md) is a
drop-in skill covering both. Hook script and settings in the
[docs](https://aadityasalgarkar.github.io/md_render/#claude).

## Development

```bash
npm run tauri:dev    # Tauri window + Vite dev server
npm run tauri:build  # production build and bundles
npm run dev          # frontend only, in a browser
npm run build:mcp    # bundle the MCP server into mcp/dist/index.js
make test            # Rust + frontend + MCP test suites
npm run lint
```

React 18 + TypeScript + Vite; react-markdown with remark-gfm, remark-math,
rehype-katex, rehype-highlight, rehype-raw; Tauri 2 with an axum server for
`--port`. Tests drive the real binary over real HTTP.

Commits follow [Conventional Commits](CONTRIBUTING.md); releases are cut
automatically by release-please, which keeps the three version files and
[CHANGELOG.md](CHANGELOG.md) in sync.

```
src/                 # React frontend
  components/        # Preview, Editor, TabBar, TableOfContents, ThemePicker, CommentPane
  lib/               # backend abstraction, theme registry, comments, image paths
  test/              # Vitest suites, including end-to-end server tests
src-tauri/src/       # Rust: lib.rs (commands), cli.rs, server.rs, attach.rs, state.rs
mcp/                 # MCP server (TypeScript), bundled by `npm run build:mcp`
bin/mdrender         # cross-platform wrapper
docs/                # documentation site (GitHub Pages), llms.txt, skills.md
```

Note: plain `cargo build --release` emits `target/release/app`, which expects
the dev server and shows a blank window. The usable binary is
`target/release/md-render`, from `npm run tauri:build`.

## License

MIT
