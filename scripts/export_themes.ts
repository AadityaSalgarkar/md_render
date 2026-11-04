/**
 * One-off move of the built-in themes into installable packages under
 * ./themes: each package gets a theme.json from src/lib/themes.ts, a theme.css
 * cut from src/index.css with its selectors narrowed to the package's own
 * ids, and an @import for the Google Fonts it names.
 *
 *   node scripts/export_themes.ts
 *
 * Run it before the definitions and rules are removed from the app; it is
 * kept for the record, not as a build step.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { themes } from '../src/lib/themes.ts'

const PACKAGES: Record<string, string[]> = {
  'warm-paper': ['warm-paper'],
  'midnight-ink': ['midnight-ink'],
  newsprint: ['newsprint'],
  forest: ['forest'],
  nocturne: ['nocturne'],
  evergreen: ['evergreen'],
  plain: ['plain'],
  ponder: ['ponder'],
  paradigm: ['paradigm'],
  claude: ['claude', 'claude-dark'],
  sonnet: ['sonnet', 'sonnet-dark'],
  latex: ['latex', 'latex-dark'],
}

/** Line ranges (1-based, inclusive) of src/index.css and the packages each belongs to. */
const RANGES: Array<[number, number, string[]]> = [
  [2043, 2057, ['nocturne']],
  [2059, 2071, ['evergreen']],
  [2073, 2101, ['newsprint']],
  [2103, 2115, ['forest']],
  [2117, 2207, ['paradigm']],
  [2209, 2215, ['claude', 'sonnet', 'latex']],
  [2217, 2263, ['claude', 'sonnet']],
  [2265, 2281, ['sonnet']],
  [2385, 2526, ['latex']],
  [2528, 2534, ['claude', 'sonnet', 'latex']],
  [2536, 2540, ['latex']],
]

/** Font families the app loaded from Google Fonts, with the axes it asked for. */
const GOOGLE_FONTS: Record<string, string> = {
  'EB Garamond': 'EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500',
  'Geist Mono': 'Geist+Mono:wght@400;500;600',
  'Google Sans Code': 'Google+Sans+Code:wght@400;500;700',
  Fraunces: 'Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500',
  'IBM Plex Mono': 'IBM+Plex+Mono:ital,wght@0,400;0,500;1,400',
  Lora: 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500',
  Literata: 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,500;0,7..72,600;0,7..72,700;1,7..72,400;1,7..72,500',
  'Playfair Display': 'Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500',
  Spectral: 'Spectral:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500',
}

const css = readFileSync('src/index.css', 'utf8').split('\n')

function selectorFor(ids: string[]): string {
  return ids.length === 1 ? `[data-theme="${ids[0]}"]` : `:is(${ids.map((id) => `[data-theme="${id}"]`).join(', ')})`
}

/** Narrow the shared prefix selectors to this package's own ids. */
function narrow(text: string, ids: string[]): string {
  const own = selectorFor(ids)
  return text
    .replaceAll('[data-theme^="claude"]:not([data-theme^="claudette"])', '[data-theme^="claude"]')
    .replace(/:is\(\[data-theme\^="[a-z]+"\](?:, \[data-theme\^="[a-z]+"\])*\)/g, own)
    .replace(/\[data-theme\^="[a-z]+"\]/g, own)
}

for (const [name, ids] of Object.entries(PACKAGES)) {
  const defs = ids.map((id) => themes.find((t) => t.id === id)!)
  const dir = `themes/${name}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/theme.json`, `${JSON.stringify({ themes: defs }, null, 2)}\n`)

  const families = new Set<string>()
  for (const def of defs) {
    for (const v of [def.vars['--font-head'], def.vars['--font-body'], def.vars['--font-mono']]) {
      for (const m of v.matchAll(/"([^"]+)"/g)) if (GOOGLE_FONTS[m[1]]) families.add(m[1])
    }
  }
  const parts: string[] = []
  if (families.size) {
    const query = [...families].sort().map((f) => `family=${GOOGLE_FONTS[f]}`).join('&')
    parts.push(`@import url('https://fonts.googleapis.com/css2?${query}&display=swap');`)
  }
  if (name === 'latex') {
    // The bundled New Computer Modern faces, moved here with their licence.
    parts.push(css.slice(4, 45).join('\n').replaceAll("url('./assets/fonts/newcm/", "url('fonts/").replace('src/assets/fonts/newcm/README-mdr-newcm.txt', 'fonts/README-mdr-newcm.txt'))
  }
  for (const [from, to, owners] of RANGES) {
    if (owners.includes(name)) parts.push(narrow(css.slice(from - 1, to).join('\n'), ids))
  }
  if (parts.length) writeFileSync(`${dir}/theme.css`, `${parts.join('\n\n').trim()}\n`)
  console.log(name, ids.join(' '), families.size ? [...families].join(', ') : '', parts.length ? 'css' : '')
}
