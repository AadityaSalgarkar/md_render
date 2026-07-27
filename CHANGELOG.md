# Changelog

## 0.1.0 (2026-07-27)

Everything shipped before versioning began:

### Features

- six typographic themes and the documentation-site reading layout: index
  with scroll-spy, reading progress, 70% measure
- Mermaid diagrams, KaTeX math, GitHub-flavored markdown, highlighted code,
  local images
- split-pane editor with save, 30-second autosave, save-on-close
- review comments stored in the markdown itself, with clean export
- Linux support alongside macOS; `make install` per platform, deb/rpm/AppImage
  bundles
- server mode (`mdrender --port`, default 10000): the same app served over
  HTTP with full editing parity, token-gated writes, and a path allowlist
- tabs across several files and directories in both the window and the
  browser; attach more files to a running server; refresh picks up documents
  added after launch
- Jupyter-style collapsible sections in the preview
- documentation site with llms.txt and skills.md; one-line curl installer
