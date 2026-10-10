#!/usr/bin/env bash
# Check a server tarball on a bare distribution, with no build packages:
# every library resolves, TikZ diagrams compile (Tectonic downloads its TeX
# files), and the server answers on its port.
#
#   scripts/check_server_tarball.sh dist-server/md-render-server-X-linux-ARCH.tar.gz IMAGE
#
# IMAGE is a stock image such as rockylinux:9 or debian:bullseye-slim. No
# curl is assumed in it: HTTP goes over bash's /dev/tcp.
set -euo pipefail

if [ "${1:-}" = "--inside" ]; then
  # ---- inside the bare container ------------------------------------------
  tarball="$2"
  cd /tmp
  tar -xzf "$tarball"
  root="/tmp/$(basename "$tarball" .tar.gz)"
  export XDG_STATE_HOME=/tmp/state XDG_CACHE_HOME=/tmp/cache MDRENDER_BROWSER=
  echo "--- $(. /etc/os-release && echo "$PRETTY_NAME"), $(ldd --version | head -n 1)"

  echo "--- libraries"
  if LD_LIBRARY_PATH= ldd "$root/bin/md-render" | grep "not found"; then
    echo "check_server_tarball: unresolved libraries" >&2
    exit 1
  fi
  echo "all resolved"

  # Every real system has CA certificates (Tectonic downloads its TeX files
  # over HTTPS); stock slim images do not, so add them like a host would.
  if [ ! -e /etc/ssl/certs/ca-certificates.crt ] && [ ! -e /etc/pki/tls/certs/ca-bundle.crt ]; then
    echo "--- adding the ca-certificates package"
    if command -v apt-get >/dev/null; then
      apt-get update -qq >/dev/null && apt-get install -y -qq ca-certificates >/dev/null
    else
      dnf install -y -q ca-certificates >/dev/null
    fi
  fi

  echo "--- tikz"
  "$root/bin/md-render" --warm-tikz
  count=$(ls /tmp/cache/md-render/tikz | grep -c '\.svg$')
  [ "$count" -ge 3 ] || { echo "check_server_tarball: expected 3 diagrams, found $count" >&2; exit 1; }

  echo "--- server"
  mkdir -p /tmp/docs
  printf '# Hello\n' > /tmp/docs/hello.md
  "$root/bin/md-render" --port 9999 /tmp/docs > /tmp/server.log 2>&1 &
  get() {
    { exec 3<>/dev/tcp/127.0.0.1/9999; } 2>/dev/null || return 1
    printf 'GET %s HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' "$1" >&3
    cat <&3
    exec 3<&-
  }
  for _ in $(seq 1 100); do get /api/health >/dev/null 2>&1 && break; sleep 0.2; done
  { get /api/health | tail -n 1 && get /api/files | grep -q hello.md; } || {
    echo "--- server log"; cat /tmp/server.log; exit 1
  }
  echo
  echo "serves hello.md"
  exit 0
fi

# ---- on the host ------------------------------------------------------------
tarball="${1:?usage: check_server_tarball.sh TARBALL IMAGE}"
image="${2:?usage: check_server_tarball.sh TARBALL IMAGE}"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$(cd "$(dirname "$tarball")" && pwd)"
platform=linux/amd64
case "$tarball" in *aarch64*) platform=linux/arm64 ;; esac
docker run --rm --platform "$platform" \
  -v "$dir:/dist:ro" -v "$here:/scripts:ro" \
  "$image" bash /scripts/check_server_tarball.sh --inside "/dist/$(basename "$tarball")"
