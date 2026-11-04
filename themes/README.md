# Theme packages

MD_RENDER has one theme built in, Claudette, in a light and a dark variant.
Every other theme is a package in this folder, installed when wanted:

```sh
mdrender --list-themes            # what is built in, what can be installed
mdrender --install-theme latex    # one or more names
mdrender --remove-theme latex     # moves it to .removed/, so it can come back
```

Installing copies the package into `$XDG_CONFIG_HOME/md-render/themes/<name>/`
(by default `~/.config/md-render/themes/`). The packages are built into the
binary, so this works from any install, Docker included. The theme menu
lists installed themes the next time a page loads.

| Package | Themes |
|---|---|
| `warm-paper` | Warm Paper (light) |
| `midnight-ink` | Midnight Ink (dark) |
| `newsprint` | Newsprint (light) |
| `forest` | Forest (light) |
| `nocturne` | Nocturne (dark) |
| `evergreen` | Evergreen (dark) |
| `plain` | Plain (light) |
| `ponder` | Ponder (light) |
| `paradigm` | Paradigm (light) |
| `claude` | Claude (light and dark) |
| `sonnet` | Sonnet (light and dark) |
| `latex` | LaTeX (light and dark), with New Computer Modern bundled |

## Adding a theme

A theme is a folder. Drop it into `~/.config/md-render/themes/` to use it
yourself, or add it here (and rebuild) to ship it with MD_RENDER.

```
mytheme/
  theme.json    required: the themes in the package
  theme.css     optional: rules beyond colours and fonts
  fonts/        optional: font files theme.css refers to
  NOTICE.md     optional: credits and licences
```

The folder name is the package name: lower-case words joined by hyphens.

### theme.json

```json
{
  "themes": [
    {
      "id": "mytheme",
      "name": "My Theme",
      "mode": "light",
      "blurb": "One line for the menu's tooltip.",
      "vars": { "--bg-primary": "#FFFFFF", "...": "..." }
    },
    { "id": "mytheme-dark", "name": "My Theme", "mode": "dark", "vars": { } }
  ]
}
```

- `id`: lower-case words joined by hyphens, unique across every theme. It
  must not start with `claudette`, whose built-in rules match by prefix.
- `mode`: `light` or `dark`; it picks the menu group and the dark-mode
  styling of plots and form controls.
- `vars`: every one of these, or the theme is skipped (the browser console
  says why):

  `--bg-primary --bg-secondary --bg-editor --bg-preview --text-primary
  --text-secondary --text-muted --accent --accent-hover --accent-secondary
  --border --border-strong --code-bg --selection --shadow-fold
  --math-display-bg --math-display-padding --font-head --font-body
  --font-mono --code-keyword --code-string --code-number --code-comment
  --code-function --code-builtin --chart-1 ... --chart-8`

  `--chart-1` to `--chart-8` colour plot series, so make them distinct
  against `--bg-primary`. Body text should keep a contrast of at least
  4.5:1 with the page (the tests check this for every package here).

### theme.css

- Scope every rule to the package's own ids, written out in full:
  `[data-theme="mytheme"] .markdown-body h1` or
  `:is([data-theme="mytheme"], [data-theme="mytheme-dark"]) ...`. Never use a
  prefix match such as `[data-theme^="my"]`, which can reach other themes.
- Web fonts: put `@import url('https://fonts.googleapis.com/css2?...')` on
  the first line. Bundled fonts: `@font-face` with
  `url('fonts/file.woff2')`, relative to the package.
- The rendered document is `.markdown-body`; its base rules are in
  `src/index.css`.

`scripts/export_themes.ts` is the one-off script that cut these packages out
of the app when Claudette became the only built-in theme.
