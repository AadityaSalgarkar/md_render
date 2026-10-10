# syntax=docker/dockerfile:1
#
# MD_RENDER as a headless server: markdown, plots and TikZ diagrams over HTTP.
#
#   docker build -t md-render .
#   docker run --rm -p 9999:9999 -v "$PWD:/docs" md-render
#   open http://127.0.0.1:9999/docs/
#
# The image serves /docs (mount your notes there). It binds 0.0.0.0 inside the
# container so the port can be published; publish it on 127.0.0.1 only
# (`-p 127.0.0.1:9999:9999`) unless others should read and edit your files.
# Trackio databases are read from /data/trackio (TRACKIO_DIR); mount yours
# there to use <plot> blocks with "project" sources.

# ---- frontend and MCP bundle ------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /src
# The MCP server is an npm workspace: its manifest must be present for npm ci.
COPY package.json package-lock.json ./
COPY mcp/package.json mcp/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:mcp

# ---- server binary ----------------------------------------------------------
FROM rust:1.92-bookworm AS server
# Built without the desktop window (--no-default-features), so no WebKit or
# GTK; Tectonic (TikZ) links ICU, fontconfig, freetype, graphite2, harfbuzz
# and libpng.
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config libssl-dev \
      libicu-dev libfontconfig1-dev libfreetype-dev libgraphite2-dev \
      libharfbuzz-dev libpng-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
# rust-embed compiles the built frontend into the binary.
COPY --from=web /src/dist ./dist
RUN cd src-tauri && cargo build --release --locked --no-default-features \
    && strip target/release/app

# ---- runtime ----------------------------------------------------------------
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libssl3 \
      libicu72 libfontconfig1 libfreetype6 libgraphite2-3 libharfbuzz0b \
      libpng16-16 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 mdrender \
    && mkdir -p /docs /data/trackio /cache \
    && chown mdrender /docs /data/trackio /cache
COPY --from=server /src/src-tauri/target/release/app /usr/local/bin/md-render

USER mdrender
# Tectonic's TeX files and rendered diagrams live in /cache; mount a volume
# there to keep them across containers.
ENV XDG_CACHE_HOME=/cache \
    XDG_STATE_HOME=/cache/state \
    TRACKIO_DIR=/data/trackio
# Fetch the TeX files TikZ needs at build time, so diagrams render offline
# and the first one does not wait minutes for a download.
# Writable by any user id, since bin/md-render-docker runs the container as
# the host user so files it writes stay theirs.
RUN md-render --warm-tikz && chmod -R a+rwX /cache

WORKDIR /docs
EXPOSE 9999
ENTRYPOINT ["md-render", "--port", "9999", "--host", "0.0.0.0"]
CMD ["/docs"]
