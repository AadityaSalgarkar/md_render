/**
 * Statistic groups: a metric logged as `P/mean` with any of `P/std`,
 * `P/min` and `P/max` beside it (`train/reward/mean`, `train/reward/std`).
 * A line plot draws the group as one series: the mean as the line and, when
 * the plot shows a single run, a shaded band of mean ± std and faint dashed
 * min and max lines. With several runs only the mean is drawn.
 */

const MEAN_LEAVES = ['mean', 'avg']
const PARTNER_LEAVES = {
  std: ['std', 'stddev'],
  min: ['min'],
  max: ['max'],
} as const

export type Partner = keyof typeof PARTNER_LEAVES

/** The partner keys of one mean key, as logged by one run. */
export type BandKeys = Partial<Record<Partner, string>>

function splitLeaf(key: string): { prefix: string; leaf: string } | null {
  const cut = key.lastIndexOf('/')
  if (cut <= 0 || cut === key.length - 1) return null
  return { prefix: key.slice(0, cut), leaf: key.slice(cut + 1) }
}

/** The partners of `key` among `logged`, or null when `key` heads no group. */
export function bandKeysOf(key: string, logged: Set<string>): BandKeys | null {
  const parts = splitLeaf(key)
  if (!parts || !MEAN_LEAVES.includes(parts.leaf)) return null
  const band: BandKeys = {}
  for (const [partner, leaves] of Object.entries(PARTNER_LEAVES) as Array<[Partner, readonly string[]]>) {
    const found = leaves.map((leaf) => `${parts.prefix}/${leaf}`).find((k) => logged.has(k))
    if (found) band[partner] = found
  }
  return Object.keys(band).length > 0 ? band : null
}

/** A band cut down to the keys the block admits, or null when none are left. */
export function within(band: BandKeys | null, admitted: Set<string>): BandKeys | null {
  if (!band) return null
  const kept = Object.fromEntries(Object.entries(band).filter(([, key]) => admitted.has(key))) as BandKeys
  return Object.keys(kept).length > 0 ? kept : null
}

/**
 * The keys among `keys` that belong to the group of a mean also in `keys`,
 * given what one run logged: these fold into the mean instead of being
 * drawn as lines of their own.
 */
export function foldedKeys(keys: string[], logged: Set<string>): Set<string> {
  const folded = new Set<string>()
  const chosen = new Set(keys)
  for (const key of keys) {
    const band = bandKeysOf(key, logged)
    if (!band) continue
    for (const partner of Object.values(band)) if (chosen.has(partner)) folded.add(partner)
  }
  return folded
}

/**
 * The `P/min` and `P/max` keys of every group among `keys`. They get no
 * chart of their own in the dropdown; `P/std` keeps one, since its trend is
 * worth reading by itself.
 */
export function extremeKeys(keys: string[]): Set<string> {
  const all = new Set(keys)
  const out = new Set<string>()
  for (const key of keys) {
    const band = bandKeysOf(key, all)
    if (band?.min) out.add(band.min)
    if (band?.max) out.add(band.max)
  }
  return out
}
