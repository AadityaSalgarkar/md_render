#!/usr/bin/env bash
# Build the headless server from source (`make build-server`): no WebKit, no
# GTK, just the frontend and the binary with Tectonic for TikZ.
#
# Tectonic links ICU, fontconfig, freetype, graphite2, HarfBuzz and libpng
# found by pkg-config. Where these live outside the system paths (a cluster's
# software tree, a prefix of your own) two things go wrong that pkg-config
# alone does not fix, so this script does:
#   - XeTeX's C++ is compiled without every -I pkg-config reports, so the
#     include directories also go on CPATH;
#   - the binary would need LD_LIBRARY_PATH at runtime, so each library
#     directory is written into it as an rpath.
# Put the .pc directories on PKG_CONFIG_PATH first.
set -euo pipefail

cd "$(dirname "$0")/.."
libs="icu-uc fontconfig freetype2 graphite2 harfbuzz libpng"

# Static mode, the way Tectonic's build asks: every Requires.private entry
# (brotli under freetype, glib under harfbuzz, ...) has to resolve as well.
if ! errors=$(pkg-config --static --exists --print-errors $libs 2>&1); then
  echo "build_server: pkg-config cannot resolve the TeX engine's libraries:" >&2
  echo "$errors" >&2
  echo "Put the directories holding these .pc files on PKG_CONFIG_PATH." >&2
  exit 1
fi

includes=$(pkg-config --static --cflags-only-I $libs | tr ' ' '\n' | sed -n 's/^-I//p' | awk '!seen[$0]++' | paste -sd: -)
rpaths=$(pkg-config --static --libs-only-L $libs | tr ' ' '\n' | sed -n 's/^-L//p' | awk '!seen[$0]++')
if [ -n "$includes" ]; then
  export CPATH="$includes${CPATH:+:$CPATH}"
fi
flags=""
for dir in $rpaths; do
  flags="$flags -C link-arg=-Wl,-rpath,$dir"
done
export RUSTFLAGS="${RUSTFLAGS:-}$flags"

# rust-embed compiles the built frontend into the binary.
npm run build
cd src-tauri
cargo build --release --locked --no-default-features
