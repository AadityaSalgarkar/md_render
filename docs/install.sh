#!/bin/sh
# MD_RENDER installer.
#
#   curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | sh
#   curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | MDRENDER_DOCKER=1 sh
#
# With MDRENDER_DOCKER=1 nothing is compiled: md-render runs the published
# Docker image (the web app; on macOS the desktop window still needs the
# app), and only docker, git, node and npm are needed.
#
# Detects the platform, checks the build prerequisites, clones the repository
# (or updates an existing checkout), and runs `make install` — which installs
# MD_RENDER.app on macOS or a user-local install under ~/.local on Linux,
# plus the ~/bin/mdrender wrapper on both. Never uses sudo; if system
# packages are missing it says which ones and stops.
set -eu

REPO="https://github.com/AadityaSalgarkar/md_render"
SRC="${MDRENDER_SRC:-$HOME/.local/src/md_render}"

say() { printf '%s\n' "$*"; }
fail() { printf 'mdrender install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

OS=$(uname -s)
case "$OS" in
  Darwin|Linux) ;;
  *) fail "unsupported platform '$OS' — MD_RENDER builds on macOS and Linux" ;;
esac

DOCKER="${MDRENDER_DOCKER:-}"

# Everything the build needs; installed by the user's package manager, not us.
missing=""
if [ -n "$DOCKER" ]; then
  tools="git node npm make docker"
else
  tools="git node npm cargo make"
fi
for tool in $tools; do
  have "$tool" || missing="$missing $tool"
done
if [ "$OS" = "Linux" ] && ! have pkg-config; then
  missing="$missing pkg-config"
fi

if [ -n "$missing" ]; then
  say "missing prerequisites:$missing"
  case "$OS" in
    Darwin) say "  brew install git node   # and Rust from https://rustup.rs" ;;
    Linux)  say "  sudo apt install git nodejs npm   # and Rust from https://rustup.rs" ;;
  esac
  fail "install the missing tools and re-run"
fi

if [ -z "$DOCKER" ] && [ "$OS" = "Linux" ] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  say "missing the webkit2gtk build libraries; on Debian/Ubuntu:"
  say "  sudo apt install build-essential curl wget file pkg-config \\"
  say "    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \\"
  say "    libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev"
  fail "install the build dependencies and re-run"
fi

# TikZ diagrams are compiled by Tectonic, which links these libraries.
if [ -z "$DOCKER" ] && [ "$OS" = "Linux" ] && ! pkg-config --exists icu-uc fontconfig freetype2 graphite2 harfbuzz libpng 2>/dev/null; then
  say "missing the TeX engine's build libraries; on Debian/Ubuntu:"
  say "  sudo apt install libicu-dev libfontconfig1-dev libfreetype-dev libgraphite2-dev \\"
  say "    libharfbuzz-dev libpng-dev zlib1g-dev"
  fail "install the build dependencies and re-run"
fi
if [ -z "$DOCKER" ] && [ "$OS" = "Darwin" ]; then
  icu_pc=""
  have brew && icu_pc="$(brew --prefix icu4c 2>/dev/null)/lib/pkgconfig"
  if ! have pkg-config || ! PKG_CONFIG_PATH="$icu_pc" pkg-config --exists icu-uc graphite2 harfbuzz freetype2 libpng 2>/dev/null; then
    say "missing the TeX engine's build libraries:"
    say "  brew install icu4c freetype graphite2 harfbuzz libpng pkgconf"
    fail "install the build dependencies and re-run"
  fi
fi

# Tectonic needs Rust 1.92 or newer.
rust_minor=$(rustc --version 2>/dev/null | sed -n 's/^rustc 1\.\([0-9]*\).*/\1/p')
if [ -z "$DOCKER" ] && { [ -z "$rust_minor" ] || [ "$rust_minor" -lt 92 ]; }; then
  say "Rust 1.92 or newer is needed (found: $(rustc --version 2>/dev/null || echo none))"
  say "  rustup update stable"
  fail "update Rust and re-run"
fi

if [ -d "$SRC/.git" ]; then
  say "updating existing checkout at $SRC"
  git -C "$SRC" fetch --tags origin
else
  say "cloning $REPO"
  say "     into $SRC"
  mkdir -p "$(dirname "$SRC")"
  git clone "$REPO" "$SRC"
fi

cd "$SRC"

# Build the latest release by default; MDRENDER_REF=main (or any ref) overrides.
if [ -n "${MDRENDER_REF:-}" ]; then
  REF="$MDRENDER_REF"
else
  REF=$(git tag --list 'v*' --sort=-version:refname | head -n 1)
  [ -n "$REF" ] || REF=main
fi
say "building $REF"
git checkout --quiet "$REF"
# A branch ref should carry its latest commits; tags are fixed points.
if git show-ref --verify --quiet "refs/heads/$REF"; then
  git merge --ff-only --quiet "origin/$REF" 2>/dev/null || true
fi
npm install --no-audit --no-fund
if [ -n "$DOCKER" ]; then
  make install-docker
else
  make install
fi

say ""
say "installed. make sure ~/bin is on your PATH, then:"
say "  mdrender README.md            # served at http://127.0.0.1:9999/<dirname>/, browser opens"
say "  mdrender --app README.md      # desktop window"
say "  mdrender --port README.md     # serve in the foreground, no browser (headless)"
say "  mdrender https://github.com/anthropics/skills/blob/main/README.md   # from the internet"
say "  claude mcp add mdrender -- mdrender --mcp   # let agents drive it"
say "  mdrender --warm-tikz         # fetch the TeX files TikZ diagrams need (once, a few minutes)"
