import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'

// Bundles the MCP server into one self-contained file, so `make install` can
// drop it anywhere without a node_modules beside it.
const here = path.dirname(fileURLToPath(import.meta.url))
const rootPackage = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as {
  version: string
}

export default defineConfig({
  root: here,
  define: {
    __MD_RENDER_VERSION__: JSON.stringify(rootPackage.version),
  },
  build: {
    ssr: path.join(here, 'src/index.ts'),
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        format: 'es',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
})
