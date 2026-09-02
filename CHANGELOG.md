# Changelog

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
