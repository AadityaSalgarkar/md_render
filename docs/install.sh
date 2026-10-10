#!/bin/sh
# MD_RENDER installer.
#
#   curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | sh
#   curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | MDRENDER_DOCKER=1 sh
#   curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | MDRENDER_SERVER=1 sh
#
# Default: clones the repository (or updates a checkout) and runs `make
# install`, which builds MD_RENDER.app on macOS or a user-local install
# under ~/.local on Linux, plus the ~/bin/mdrender wrapper on both.
#
# MDRENDER_DOCKER=1: nothing is compiled; md-render runs the published
# Docker image (the web app). Needs docker, git, node and npm.
#
# MDRENDER_SERVER=1 (Linux): the headless server only (the web app, no
# desktop window), prebuilt: one download, no compiler, root, Docker or
# LD_LIBRARY_PATH, on any glibc 2.28+ x86_64 or aarch64 Linux. Chosen
# automatically on Linux when the desktop app's WebKit libraries are
# missing, as on a cluster login node. MDRENDER_SERVER=build compiles it
# instead (`make install-server`).
#
# MDRENDER_TARBALL=<file or URL> installs that server tarball instead of the
# release download (a machine that cannot reach GitHub: scp it over first).
#
# Where things go: MDRENDER_PREFIX (default ~/.local) and MDRENDER_BIN_DIR
# (default ~/bin, or $MDRENDER_PREFIX/bin when a prefix is given).
#
# Never uses sudo; if system packages are missing it says which ones and
# stops. The script is one function, called on its last line, so it is read
# completely before anything runs.
set -eu

REPO="https://github.com/AadityaSalgarkar/md_render"
API="https://api.github.com/repos/AadityaSalgarkar/md_render"

say() { printf '%s\n' "$*"; }
fail() { printf 'mdrender install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# The release tag to install: MDRENDER_REF, else the latest release.
latest_tag() {
  if [ -n "${MDRENDER_REF:-}" ]; then
    printf '%s\n' "$MDRENDER_REF"
    return
  fi
  curl -fsSL "$API/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1
}

# The prebuilt server: unpack the release tarball under the prefix and link
# the wrapper and the binary into the bin directories.
install_prebuilt_server() {
  for tool in curl tar; do
    have "$tool" || fail "the prebuilt server needs $tool"
  done
  case "$(uname -m)" in
    x86_64|amd64) arch=x86_64 ;;
    aarch64|arm64) arch=aarch64 ;;
    *) fail "no prebuilt server for $(uname -m); try MDRENDER_SERVER=build" ;;
  esac
  # MDRENDER_TARBALL: a tarball already here (copied over by scp to a machine
  # that cannot reach GitHub) or another URL.
  if [ -n "${MDRENDER_TARBALL:-}" ]; then
    url="$MDRENDER_TARBALL"
    name=$(basename "$url" .tar.gz)
    tag="v$(printf '%s\n' "$name" | sed -n 's/^md-render-server-\(.*\)-linux-.*/\1/p')"
  else
    tag=$(latest_tag)
    [ -n "$tag" ] || fail "could not find the latest release (set MDRENDER_REF=vX.Y.Z)"
    name="md-render-server-${tag#v}-linux-$arch"
    url="$REPO/releases/download/$tag/$name.tar.gz"
  fi

  tree="$PREFIX/lib/md-render/server"
  mkdir -p "$PREFIX/lib/md-render" "$PREFIX/bin" "$BIN_DIR"
  work="$PREFIX/lib/md-render/.download"
  rm -rf "$work"
  mkdir -p "$work"
  if [ -f "$url" ]; then
    tar -xzf "$url" -C "$work" || fail "could not unpack $url"
  else
    say "downloading $url"
    curl -fSL --progress-bar "$url" | tar -xz -C "$work" \
      || fail "download failed: $url"
  fi
  [ -x "$work/$name/bin/md-render" ] || fail "$url does not hold $name/bin/md-render"
  # Swap the whole tree at once, so a running server keeps its files.
  if [ -d "$tree" ]; then
    rm -rf "$tree.old"
    mv "$tree" "$tree.old"
  fi
  mv "$work/$name" "$tree"
  rm -rf "$work" "$tree.old"

  ln -sf "$tree/bin/md-render" "$PREFIX/bin/md-render"
  ln -sf "$tree/bin/mdrender" "$BIN_DIR/mdrender"

  # TikZ: Tectonic downloads its TeX files over HTTPS with the system's roots.
  if [ ! -e /etc/ssl/certs/ca-certificates.crt ] && [ ! -e /etc/pki/tls/certs/ca-bundle.crt ] \
    && [ -z "${SSL_CERT_FILE:-}" ]; then
    say "note: no CA certificates found; TikZ diagrams need them (the ca-certificates package)"
  fi

  say ""
  say "installed the md-render $tag server to $tree"
  say "  $BIN_DIR/mdrender -> $tree/bin/mdrender"
  say "  $PREFIX/bin/md-render -> $tree/bin/md-render"
}

main() {
  OS=$(uname -s)
  case "$OS" in
    Darwin|Linux) ;;
    *) fail "unsupported platform '$OS' — MD_RENDER builds on macOS and Linux" ;;
  esac

  DOCKER="${MDRENDER_DOCKER:-}"
  SERVER="${MDRENDER_SERVER:-}"
  if [ -n "${MDRENDER_PREFIX:-}" ]; then
    PREFIX="$MDRENDER_PREFIX"
    BIN_DIR="${MDRENDER_BIN_DIR:-$PREFIX/bin}"
    SRC="${MDRENDER_SRC:-$PREFIX/src/md_render}"
  else
    PREFIX="$HOME/.local"
    BIN_DIR="${MDRENDER_BIN_DIR:-$HOME/bin}"
    SRC="${MDRENDER_SRC:-$HOME/.local/src/md_render}"
  fi

  if [ -n "$SERVER" ] && [ "$OS" != "Linux" ]; then
    fail "MDRENDER_SERVER is for Linux; on macOS use the default install or MDRENDER_DOCKER=1"
  fi

  # No WebKit on Linux (a cluster login node, a headless server): the desktop
  # app cannot build, but the server needs none of it.
  if [ -z "$DOCKER" ] && [ -z "$SERVER" ] && [ "$OS" = "Linux" ] \
    && ! { have pkg-config && pkg-config --exists webkit2gtk-4.1 2>/dev/null; }; then
    say "no webkit2gtk build libraries here, so installing the headless server"
    say "(the web app; the desktop window needs libwebkit2gtk-4.1-dev and a re-run)"
    SERVER=1
  fi

  if [ "$SERVER" = "1" ]; then
    install_prebuilt_server
    finish
    return
  fi

  # Everything a build needs; installed by the user's package manager, not us.
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

  if [ -z "$DOCKER" ] && [ -z "$SERVER" ] && [ "$OS" = "Linux" ] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    say "missing the webkit2gtk build libraries; on Debian/Ubuntu:"
    say "  sudo apt install build-essential curl wget file pkg-config \\"
    say "    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \\"
    say "    libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev"
    fail "install the build dependencies and re-run"
  fi

  # TikZ diagrams are compiled by Tectonic, which links these libraries
  # statically through pkg-config: every Requires.private must resolve too.
  if [ -z "$DOCKER" ] && [ "$OS" = "Linux" ]; then
    if ! errors=$(pkg-config --static --exists --print-errors icu-uc fontconfig freetype2 graphite2 harfbuzz libpng 2>&1); then
      say "pkg-config cannot resolve the TeX engine's build libraries:"
      say "$errors"
      say "on Debian/Ubuntu:"
      say "  sudo apt install libicu-dev libfontconfig1-dev libfreetype-dev libgraphite2-dev \\"
      say "    libharfbuzz-dev libpng-dev zlib1g-dev"
      say "elsewhere (no root), put the directories holding their .pc files on PKG_CONFIG_PATH,"
      say "or skip compiling: MDRENDER_SERVER=1 installs the prebuilt server"
      fail "install the build dependencies and re-run"
    fi
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
    say "no rustup, or a system Rust? a user-local one, kept wherever you like:"
    say "  export RUSTUP_HOME=/scratch/rustup CARGO_HOME=/scratch/cargo PATH=/scratch/cargo/bin:\$PATH"
    say "  curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal"
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
    make install-docker PREFIX="$PREFIX" BIN_DIR="$BIN_DIR" MCP_DIR="$PREFIX/share/md-render/mcp"
  elif [ "$SERVER" = "build" ]; then
    make install-server PREFIX="$PREFIX" BIN_DIR="$BIN_DIR" MCP_DIR="$PREFIX/share/md-render/mcp"
  else
    make install PREFIX="$PREFIX" BIN_DIR="$BIN_DIR" MCP_DIR="$PREFIX/share/md-render/mcp"
  fi
  finish
}

finish() {
  say ""
  say "installed. make sure $BIN_DIR is on your PATH, then:"
  say "  mdrender README.md            # served at http://127.0.0.1:9999/<dirname>/, browser opens"
  if [ -z "$SERVER" ]; then
    say "  mdrender --app README.md      # desktop window"
  fi
  say "  mdrender --port README.md     # serve in the foreground, no browser (headless)"
  say "  mdrender https://github.com/anthropics/skills/blob/main/README.md   # from the internet"
  say "  claude mcp add mdrender -- mdrender --mcp   # let agents drive it"
  say "  mdrender --warm-tikz         # fetch the TeX files TikZ diagrams need (once, a few minutes)"
  if [ -n "$SERVER" ]; then
    say "on a remote machine, reach the server over ssh from your laptop:"
    say "  ssh -L 9999:127.0.0.1:9999 <host>   # then open http://127.0.0.1:9999/"
  fi
}

main "$@"
