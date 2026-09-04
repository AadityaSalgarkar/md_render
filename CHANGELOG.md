# Changelog

## [0.4.0](https://github.com/AadityaSalgarkar/md_render/compare/v0.3.0...v0.4.0) (2026-09-04)


### Features

* **app:** apply view state pushed by the server ([fa74b4d](https://github.com/AadityaSalgarkar/md_render/commit/fa74b4da46732b3ad9d09b41afec5f569a473d5e))
* keep edits to remote documents outside /tmp ([ba16335](https://github.com/AadityaSalgarkar/md_render/commit/ba16335c215e3ed37de05f12546796cac91ef84f))
* MCP server for the --port web mode ([38cb6e4](https://github.com/AadityaSalgarkar/md_render/commit/38cb6e4ae5bba8cc1e9065d4e4ad22004aa8bf90))
* **mcp:** focus a tab and set the theme in an open browser ([3bd536b](https://github.com/AadityaSalgarkar/md_render/commit/3bd536bf8eb7d4fb92430f5ae9dfe0e7df7648de))
* **mcp:** open URLs with open_tab and start_server ([f191798](https://github.com/AadityaSalgarkar/md_render/commit/f1917987eabb8dc7e2f9d46acb00cdfc87d19216))
* **mcp:** read, write, comment on and export documents ([a7e93a7](https://github.com/AadityaSalgarkar/md_render/commit/a7e93a7b8370b87a0a7abd9ebbc3d1c2b073d041))
* **mcp:** report the saved copy from write_document and add_comment ([c570f0b](https://github.com/AadityaSalgarkar/md_render/commit/c570f0b0f69c718fd6b2abd26c3f5a206e90c569))
* **mcp:** scaffold the MCP package with server discovery ([0023366](https://github.com/AadityaSalgarkar/md_render/commit/002336674e051aa71adaf9a3ac6bc7fa62ac0f38))
* **mcp:** start and stop servers ([3f88279](https://github.com/AadityaSalgarkar/md_render/commit/3f88279437ee313b244f897b3e60ae257b5a57f2))
* **mcp:** workspace and tab tools ([c094ad8](https://github.com/AadityaSalgarkar/md_render/commit/c094ad80fab6fa9cd58e28e412a6b07016121df8))
* open markdown from a URL, and a styled root listing ([573cce0](https://github.com/AadityaSalgarkar/md_render/commit/573cce05a91a53dd566692bc025a38b77e7efe05))
* open markdown from a URL, in the window and over --port ([95a59f4](https://github.com/AadityaSalgarkar/md_render/commit/95a59f4c198c732dc786ebea0da88370416d7fa9))
* **server:** a root listing in the documentation site's style ([acc16bb](https://github.com/AadityaSalgarkar/md_render/commit/acc16bbd58c1c078236c162cae47249b95a622cc))
* **server:** close a whole workspace over HTTP ([69d9c45](https://github.com/AadityaSalgarkar/md_render/commit/69d9c45d8c1fb9082bed8bd7eb6a4b619790ccf6))
* **server:** let POST /api/documents target a workspace by name ([a365ea2](https://github.com/AadityaSalgarkar/md_render/commit/a365ea213980b058996e2ff29789654f5952db4e))
* **server:** name the workspace on each entry of the tab list ([e65e205](https://github.com/AadityaSalgarkar/md_render/commit/e65e205714203defafa8c75b95997e21dbb442c2))
* **server:** per-workspace view state for remote focus and theme ([57b7d45](https://github.com/AadityaSalgarkar/md_render/commit/57b7d45727bd31bf69ea2612cbccef9191c1e304))
* **server:** stop the server over HTTP ([83d759b](https://github.com/AadityaSalgarkar/md_render/commit/83d759b47540117158e6eff93e49d0aa90d6b0e1))
* **wrapper:** add --mcp and install the MCP bundle ([39da9d9](https://github.com/AadityaSalgarkar/md_render/commit/39da9d99fb5358642553e25b4975eb9995585971))
* **wrapper:** pass URLs through to the app ([c3ae1e8](https://github.com/AadityaSalgarkar/md_render/commit/c3ae1e883154aada4bcda934c75248f17d29b495))

## [0.3.0](https://github.com/AadityaSalgarkar/md_render/compare/v0.2.0...v0.3.0) (2026-09-02)


### Features

* **cli:** mdrender -h prints usage without launching anything ([c4ace47](https://github.com/AadityaSalgarkar/md_render/commit/c4ace47a4d625feff989d000f08d68a48a018834))
* closable tabs with stable document ids in both modes ([9883890](https://github.com/AadityaSalgarkar/md_render/commit/9883890311e99ff2ae12c366938c830259a26c4b))
* desktop multi-file tabs on macOS and closable tabs in both modes ([ba8c902](https://github.com/AadityaSalgarkar/md_render/commit/ba8c902fa261ce02ad6b0aeacbf38fde9f6ad405))
* **desktop:** open every file argument as a tab on macOS ([f08eb74](https://github.com/AadityaSalgarkar/md_render/commit/f08eb7458bd70112cb9e9e766825132352f9741a))
* workspace URLs on a fixed default port ([b5008dc](https://github.com/AadityaSalgarkar/md_render/commit/b5008dc73d62fbfc4f31ff55a300c439e32e30af))
* workspace URLs on a fixed default port (9999) and mdrender -h ([49ae7b8](https://github.com/AadityaSalgarkar/md_render/commit/49ae7b85c302bc478670e1ef4534effb5296371c))


### Bug Fixes

* absolutise source paths before attaching to a running server ([dcaff44](https://github.com/AadityaSalgarkar/md_render/commit/dcaff44f19c540277274eda47f1269696dcfdb83))

## [0.2.0](https://github.com/AadityaSalgarkar/md_render/compare/v0.1.0...v0.2.0) (2026-07-27)


### Features

* explicit highlight-to-comment mode, and vertical controls ([705cd19](https://github.com/AadityaSalgarkar/md_render/commit/705cd195147fa3dfab159c06898fcdf5c86759c1))
* gate highlight-to-comment behind an explicit mode ([4a93802](https://github.com/AadityaSalgarkar/md_render/commit/4a93802107151cad6ca44903f4dc2df065b7a89b))
* hidden answer tag opened only by an explicit click ([7dd7928](https://github.com/AadityaSalgarkar/md_render/commit/7dd792816d3eee98983ae13d2f1ed3ada6a33b97))
* quiz blocks with options hidden behind an eye button ([d9e7a29](https://github.com/AadityaSalgarkar/md_render/commit/d9e7a29bb104efc94cf2bf8fccb0af3e748629ed))
* quiz blocks with options hidden behind an eye button ([88a0654](https://github.com/AadityaSalgarkar/md_render/commit/88a065432f930efe11f8440b8fb78adac2711436))
* stack the floating controls vertically ([0d4d1ce](https://github.com/AadityaSalgarkar/md_render/commit/0d4d1ce81091188788c0f42d8033d999c13ae27f))


### Bug Fixes

* make hiding an opened answer discoverable ([e6722b6](https://github.com/AadityaSalgarkar/md_render/commit/e6722b6204f8b4ea6c80414e84ec75056fdf3109))

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
