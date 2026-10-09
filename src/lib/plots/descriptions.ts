/**
 * What a metric means, from the block's `descriptions` map. Patterns are
 * exact keys or globs over `/`-separated paths: `*` matches within one
 * segment, a `**` segment matches any number of segments. When several
 * patterns match, the most specific wins.
 */

/** Longest description shown; longer text is cut with an ellipsis. */
export const MAX_DESCRIPTION_LENGTH = 240

interface Compiled {
  pattern: string
  regex: RegExp
  /** Sort key: higher is more specific. */
  rank: [number, number, number, number]
}

function escape(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** A glob as an anchored regex. */
export function globToRegex(glob: string): RegExp {
  const segments = glob.split('/')
  let source = ''
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1
    if (segment === '**') {
      // Zero or more whole segments, slash included.
      source += last ? '.*' : '(?:[^/]+/)*'
      return
    }
    source += segment.split('*').map(escape).join('[^/]*')
    if (!last) source += '/'
  })
  return new RegExp(`^${source}$`)
}

function compile(pattern: string): Compiled {
  const segments = pattern.split('/')
  const literal = segments.filter((s) => !s.includes('*')).length
  const doubles = segments.filter((s) => s === '**').length
  const singles = (pattern.match(/\*/g) ?? []).length - doubles * 2
  return {
    pattern,
    regex: globToRegex(pattern),
    rank: [pattern.includes('*') ? 0 : 1, literal, -doubles, -singles],
  }
}

function better(a: Compiled, b: Compiled): boolean {
  for (let i = 0; i < a.rank.length; i += 1) {
    if (a.rank[i] !== b.rank[i]) return a.rank[i] > b.rank[i]
  }
  return a.pattern.length > b.pattern.length
}

/** Look up descriptions for metric keys. */
export function describer(descriptions: Record<string, string>): (key: string) => string | null {
  const compiled = Object.keys(descriptions).map(compile)
  const cache = new Map<string, string | null>()
  return (key) => {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let best: Compiled | null = null
    for (const candidate of compiled) {
      if (candidate.regex.test(key) && (!best || better(candidate, best))) best = candidate
    }
    const text = best ? clip(descriptions[best.pattern]) : null
    cache.set(key, text)
    return text
  }
}

/** Plain text, at most MAX_DESCRIPTION_LENGTH characters. */
export function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= MAX_DESCRIPTION_LENGTH) return flat
  return `${flat.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
}
