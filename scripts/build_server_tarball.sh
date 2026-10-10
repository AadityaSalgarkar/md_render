#!/usr/bin/env bash
# Build the headless server as a portable Linux tarball: no WebKit, no root,
# no compiler and nothing on LD_LIBRARY_PATH needed where it is unpacked.
#
#   npm ci && npm run build && npm run build:mcp
#   scripts/build_server_tarball.sh x86_64|aarch64 [VERSION]
#
# The build runs in the manylinux_2_28 image (AlmaLinux 8, glibc 2.28), so the
# binary runs on any newer glibc. The libraries Tectonic links (ICU,
# fontconfig, freetype, graphite2, HarfBuzz, libpng, ...) are copied into
# lib/ next to it and found through an $ORIGIN rpath. Writes
# dist-server/md-render-server-<version>-linux-<arch>.tar.gz:
#
#   bin/md-render                  the server
#   bin/mdrender                   the wrapper
#   lib/*.so*                      the libraries glibc does not provide
#   share/md-render/mcp/index.js   the MCP server
set -euo pipefail

if [ "${1:-}" = "--inside" ]; then
  # ---- inside the manylinux container -------------------------------------
  arch="$2" version="$3" owner="$4"
  cd /src
  # A flaky mirror (EPEL, which none of these need) must not fail the build.
  for attempt in 1 2 3; do
    if dnf install -y -q --setopt=skip_if_unavailable=True libicu-devel fontconfig-devel \
      freetype-devel graphite2-devel harfbuzz-devel libpng-devel zlib-devel >/dev/null; then
      break
    fi
    [ "$attempt" = 3 ] && exit 1
    sleep 10
  done
  export RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH="/opt/cargo/bin:$PATH"
  if ! command -v cargo >/dev/null; then
    curl -fsSL https://sh.rustup.rs | sh -s -- -y -q --no-modify-path --profile minimal \
      --default-toolchain 1.92.0
  fi
  # A target directory of its own (a volume): the host's objects (macOS, or a
  # newer glibc) must not be reused.
  export CARGO_TARGET_DIR=/target
  (cd src-tauri && cargo build --release --locked --no-default-features)

  name="md-render-server-$version-linux-$arch"
  stage="/tmp/$name"
  rm -rf "$stage"
  mkdir -p "$stage/bin" "$stage/lib" "$stage/share/md-render/mcp"
  install -m 755 "$CARGO_TARGET_DIR/release/app" "$stage/bin/md-render"
  strip "$stage/bin/md-render"
  install -m 755 bin/mdrender "$stage/bin/mdrender"
  install -m 644 mcp/dist/index.js "$stage/share/md-render/mcp/index.js"

  # Every library ldd resolves, except glibc's own and the C++ and gcc
  # runtimes that every glibc system ships (newer ones stay compatible).
  ldd "$stage/bin/md-render" | awk '/=> \// { print $3 }' | while read -r lib; do
    case "$(basename "$lib")" in
      ld-linux*|libc.so*|libm.so*|libdl.so*|libpthread.so*|librt.so*|libutil.so*|libresolv.so*|libgcc_s.so*|libstdc++.so*) ;;
      *) cp -L "$lib" "$stage/lib/" ;;
    esac
  done
  patchelf --set-rpath '$ORIGIN/../lib' "$stage/bin/md-render"
  for lib in "$stage"/lib/*.so*; do patchelf --set-rpath '$ORIGIN' "$lib"; done

  if LD_LIBRARY_PATH='' ldd "$stage/bin/md-render" | grep "not found"; then
    echo "build_server_tarball: unresolved libraries" >&2
    exit 1
  fi
  mkdir -p dist-server
  tar -C /tmp -czf "dist-server/$name.tar.gz" "$name"
  chown -R "$owner" dist-server
  ls -la "dist-server/$name.tar.gz"
  exit 0
fi

# ---- on the host ------------------------------------------------------------
arch="${1:?usage: build_server_tarball.sh x86_64|aarch64 [VERSION]}"
case "$arch" in
  x86_64|aarch64) ;;
  *) echo "build_server_tarball: arch is x86_64 or aarch64, not $arch" >&2; exit 2 ;;
esac
repo="$(cd "$(dirname "$0")/.." && pwd)"
version="${2:-$(sed -n 's/^version = "\(.*\)"/\1/p' "$repo/src-tauri/Cargo.toml" | head -n 1)}"
for built in dist/index.html mcp/dist/index.js; do
  [ -f "$repo/$built" ] || { echo "build_server_tarball: build the frontend and MCP bundle first ($built missing)" >&2; exit 1; }
done
platform=linux/amd64; [ "$arch" = aarch64 ] && platform=linux/arm64
docker run --rm --platform "$platform" \
  -v "$repo:/src" \
  -v "md-render-manylinux-cargo-$arch:/opt/cargo" \
  -v "md-render-manylinux-rustup-$arch:/opt/rustup" \
  -v "md-render-manylinux-target-$arch:/target" \
  "quay.io/pypa/manylinux_2_28_$arch" \
  bash /src/scripts/build_server_tarball.sh --inside "$arch" "$version" "$(id -u):$(id -g)"
