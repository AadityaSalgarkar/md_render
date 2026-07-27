# Contributing

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org).
Releases are cut automatically from them by release-please, so the prefix
decides the version bump:

| Prefix | Effect |
|---|---|
| `fix: ...` | patch release |
| `feat: ...` | minor release |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major (minor while pre-1.0) |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:` | no release |

Examples:

```
feat: add collapsible sections to the preview
fix: expand collapsed ancestors when navigating from the index
docs: describe the server security model
```

## How a release happens

1. Conventional commits land on `main` (via PR, with CI green).
2. release-please maintains a release PR that accumulates the changelog and
   bumps the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` (they must always agree).
3. Merging that PR tags `vX.Y.Z` and creates the GitHub Release; CI then
   builds and attaches the artifacts (dmg + app for macOS; deb, rpm and
   AppImage for Linux).

Never edit the version fields by hand — the release PR owns them.

## Development

```bash
npm install
npm run tauri:dev    # Tauri window + Vite dev server
make test            # Rust + frontend suites
npm run lint
```

CI runs lint, the TypeScript build, both test suites and a debug binary
build on Linux and macOS for every PR; `ci-ok` must be green to merge.
Tests never mock the code under test — the server suites drive the real
binary over real HTTP.
