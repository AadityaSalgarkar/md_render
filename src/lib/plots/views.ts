/**
 * Views: named selections of runs and metrics with a grouping, listed in the
 * plot's dropdown. Authors write some in the block; the rest are derived
 * from the data, which assumes consistent `split/family/name` metric keys
 * (`train/loss/ce`, `val/loss/ce`, `val/acc/top1`).
 */

import type { RunInfo } from './types'
import {
  compilePattern,
  type AxisX,
  type AxisY,
  type ItemStyle,
  type PlotItem,
  type PlotSpec,
  type Selector,
} from './schema'

export type ViewOrigin = 'series' | 'block' | 'derived' | 'custom'

export interface View {
  name: string
  origin: ViewOrigin
  runs?: Selector
  metrics?: Selector
  group_by: string
  legend?: string
  x?: Partial<AxisX>
  y?: Partial<AxisY>
  /** Only for the "Series" view built from `items`. */
  items?: PlotItem[]
}

export interface ResolvedSeries {
  /** Stable within a view: run and key, plus the item index for items. */
  id: string
  run: string
  key: string
  group: string
  label: string
  metadata: string | null
  description: string | null
  style: ItemStyle | null
  /** Position of the group among the view's groups: picks the hue. */
  groupIndex: number
  /** Position within the group and the group's size: picks the shade. */
  shade: number
  shadeCount: number
  /** Index into the dash styles. */
  dash: number
}

export interface Resolution {
  series: ResolvedSeries[]
  groups: string[]
  runs: string[]
  keys: string[]
  /** Why nothing matched, for the figure to say. */
  empty: string | null
}

export const SPLITS = ['train', 'training', 'val', 'valid', 'validation', 'eval', 'test'] as const
const SPLIT_RE = new RegExp(`^(${SPLITS.join('|')})([/_])(.+)$`)
const HELD_OUT_RE = /^(val|valid|validation|eval|test)[/_]/

const CAP_PER_KEY = 24
const CAP_FAMILY = 8
const CAP_CONFIG = 12
const CAP_PRIMARY = 4
const SKIPPED_CONFIG = /^(_|wandb|trackio)/

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const naturalCompare = (a: string, b: string) => collator.compare(a, b)

/**
 * Names picked by a selector. A regex keeps the input order; a list keeps
 * its own order and only names that exist. Keys starting with "_" are
 * internal (trackio's `__step`) and only a list can pick them.
 */
export function select(selector: Selector, names: string[], hideInternal = false): string[] {
  if (Array.isArray(selector)) {
    const present = new Set(names)
    return selector.filter((name) => present.has(name))
  }
  const regex = compilePattern(selector, 'selector')
  return names.filter((name) => (!hideInternal || !name.startsWith('_')) && regex.test(name))
}

/** Every scalar key logged by the given runs, sorted. */
export function keysOf(runs: RunInfo[]): string[] {
  const keys = new Set<string>()
  for (const run of runs) for (const k of run.keys) keys.add(k.key)
  return [...keys].sort(naturalCompare)
}

function defaultGroupBy(spec: PlotSpec): string {
  return spec.plot_type === 'scatter' ? 'none' : 'run'
}

/** Split a key into its split prefix and metric path, if it has one. */
export function splitKey(key: string): { split: string; sep: string; path: string } | null {
  const match = SPLIT_RE.exec(key)
  return match ? { split: match[1], sep: match[2], path: match[3] } : null
}

/** The runs and keys a spec's top-level selection admits. */
function universe(spec: PlotSpec, runs: RunInfo[]) {
  const runNames = select(spec.runs, runs.map((r) => r.name))
  const chosen = runs.filter((r) => runNames.includes(r.name))
  const keys = select(spec.metrics, keysOf(chosen), true)
  return { runs: chosen, keys }
}

/** The dropdown: the Series view, the block's views, then views derived from the data. */
export function deriveViews(spec: PlotSpec, runs: RunInfo[]): View[] {
  const views: View[] = []
  if (spec.items.length > 0) {
    views.push({ name: 'Series', origin: 'series', group_by: 'none', items: spec.items })
  }
  for (const view of spec.views) {
    views.push({ ...view, origin: 'block', group_by: view.group_by ?? defaultGroupBy(spec) })
  }

  const taken = new Set(views.map((v) => v.name))
  for (const view of derivedViews(spec, runs)) {
    if (taken.has(view.name)) continue
    taken.add(view.name)
    views.push(view)
  }
  return views
}

function derivedViews(spec: PlotSpec, allRuns: RunInfo[]): View[] {
  const { runs, keys } = universe(spec, allRuns)
  if (runs.length === 0 || keys.length === 0) return []
  const single = runs.length === 1
  const derived = (view: Omit<View, 'origin'>): View => ({ ...view, origin: 'derived' })

  if (spec.plot_type === 'scatter' && spec.scatter) {
    const out = [derived({ name: 'all runs', group_by: 'none' })]
    out.push(...configViews(runs, [spec.scatter.y], true).map((v) => ({ ...v, metrics: undefined })))
    return out
  }

  const freq = new Map<string, number>()
  for (const run of runs) for (const k of run.keys) freq.set(k.key, (freq.get(k.key) ?? 0) + 1)
  const byFrequency = [...keys].sort(
    (a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || naturalCompare(a, b),
  )

  const out: View[] = []

  if (spec.plot_type === 'line') {
    out.push(...splitViews(keys, single))
  } else {
    out.push(derived({ name: 'all metrics', group_by: 'run' }))
  }
  out.push(...familyViews(keys, single))

  out.push(
    ...byFrequency.slice(0, CAP_PER_KEY).map((key) =>
      derived({
        name: single ? key : `${key} across runs`,
        metrics: `^${escapeRegex(key)}$`,
        group_by: 'run',
      }),
    ),
  )

  if (!single) {
    const primary = Array.isArray(spec.metrics)
      ? spec.metrics.filter((k) => keys.includes(k))
      : keys.filter((k) => HELD_OUT_RE.test(k)).length > 0
        ? keys.filter((k) => HELD_OUT_RE.test(k))
        : byFrequency
    out.push(...configViews(runs, primary.slice(0, CAP_PRIMARY), false))
  }
  return out
}

/** "loss/ce: train vs val", one per metric path logged under two or more splits. */
function splitViews(keys: string[], single: boolean): View[] {
  const byPath = new Map<string, { splits: string[]; keys: string[] }>()
  for (const key of keys) {
    const parts = splitKey(key)
    if (!parts) continue
    const entry = byPath.get(parts.path) ?? { splits: [], keys: [] }
    if (!entry.splits.includes(parts.split)) entry.splits.push(parts.split)
    entry.keys.push(key)
    byPath.set(parts.path, entry)
  }
  const order = (s: string) => SPLITS.indexOf(s as (typeof SPLITS)[number])
  const out: View[] = []
  for (const [path, entry] of [...byPath].sort((a, b) => naturalCompare(a[0], b[0]))) {
    if (entry.splits.length < 2) continue
    const splits = [...entry.splits].sort((a, b) => order(a) - order(b))
    const versus = splits.join(' vs ')
    out.push({
      name: single ? `${versus}: ${path}` : `${path}: ${versus}`,
      origin: 'derived',
      metrics: entry.keys.sort((a, b) => order(splitKey(a)!.split) - order(splitKey(b)!.split)),
      group_by: single ? 'metric' : 'run',
    })
  }
  return out
}

/** "train/loss components": the leaves under one family, e.g. train/loss/ce and train/loss/kl. */
function familyViews(keys: string[], single: boolean): View[] {
  const families = new Map<string, string[]>()
  for (const key of keys) {
    const cut = key.lastIndexOf('/')
    if (cut <= 0 || !key.slice(0, cut).includes('/')) continue
    const family = key.slice(0, cut)
    families.set(family, [...(families.get(family) ?? []), key])
  }
  const out: View[] = []
  for (const [family, leaves] of [...families].sort((a, b) => naturalCompare(a[0], b[0]))) {
    if (leaves.length < 2 || leaves.length > 12) continue
    out.push({
      name: `${family} components`,
      origin: 'derived',
      metrics: leaves,
      group_by: single ? 'metric' : 'run',
    })
    if (out.length >= CAP_FAMILY) break
  }
  return out
}

/** Config keys that split the runs into 2 to 8 groups, each with a value. */
export function configCandidates(runs: RunInfo[]): string[] {
  const values = new Map<string, Map<string, number>>()
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.config)) {
      if (SKIPPED_CONFIG.test(key)) continue
      const seen = values.get(key) ?? new Map<string, number>()
      const text = String(value)
      seen.set(text, (seen.get(text) ?? 0) + 1)
      values.set(key, seen)
    }
  }
  const out: string[] = []
  for (const [key, seen] of values) {
    const defined = [...seen.values()].reduce((a, b) => a + b, 0)
    const distinct = seen.size
    if (defined < 2 || distinct < 2 || distinct > 8) continue
    // A value per run (seeds, timestamps, paths) is not a grouping.
    if (defined >= 3 && distinct === defined) continue
    out.push(key)
  }
  return out.sort(naturalCompare)
}

function configViews(runs: RunInfo[], primary: string[], scatter: boolean): View[] {
  const out: View[] = []
  for (const configKey of configCandidates(runs)) {
    for (const key of scatter ? [primary[0]] : primary) {
      out.push({
        name: scatter ? `by ${configKey}` : `${key} by ${configKey}`,
        origin: 'derived',
        metrics: [key],
        group_by: `config:${configKey}`,
      })
      if (out.length >= CAP_CONFIG) return out
    }
  }
  return out
}

/**
 * The view to open with: the block's `default_view`, else the Series view,
 * else the first view the block wrote, else the first derived one.
 */
export function defaultView(spec: PlotSpec, views: View[]): View | null {
  if (spec.default_view) {
    const named = views.find((v) => v.name === spec.default_view)
    if (named) return named
  }
  return (
    views.find((v) => v.origin === 'series') ??
    views.find((v) => v.origin === 'block') ??
    views[0] ??
    null
  )
}

function fillLegend(
  template: string,
  values: { run: string; metric: string; group: string },
  config: Record<string, unknown>,
): string {
  return template.replace(/\{(run|metric|group|config:[^}]+)\}/g, (_, token: string) => {
    if (token === 'run') return values.run
    if (token === 'metric') return values.metric
    if (token === 'group') return values.group
    const value = config[token.slice('config:'.length)]
    return value === undefined ? '(unset)' : String(value)
  })
}

/** Which series a view shows, grouped and labelled, with style indices. */
export function resolveView(
  view: View,
  spec: PlotSpec,
  runs: RunInfo[],
  describe: (key: string) => string | null = () => null,
): Resolution {
  const byName = new Map(runs.map((r) => [r.name, r]))
  if (view.items) return resolveItems(view.items, runs, byName, describe)

  const runSelector = view.runs ?? spec.runs
  let chosen = select(runSelector, runs.map((r) => r.name)).map((n) => byName.get(n)!)
  let keys: string[]
  if (spec.plot_type === 'scatter' && spec.scatter) {
    keys = [spec.scatter.y]
    chosen = chosen.filter((r) => r.keys.some((k) => k.key === spec.scatter!.y))
  } else {
    keys = select(view.metrics ?? spec.metrics, keysOf(chosen), true)
  }

  if (chosen.length === 0) {
    const what = Array.isArray(runSelector) ? runSelector.join(', ') : runSelector
    return { series: [], groups: [], runs: [], keys: [], empty: `No run matches ${what}.` }
  }

  const groupBy = view.group_by
  const groupOf = groupFunction(groupBy)
  const pairs: Array<{ run: RunInfo; key: string; group: string }> = []
  for (const run of chosen) {
    const logged = new Set(run.keys.map((k) => k.key))
    for (const key of keys) {
      if (logged.has(key)) pairs.push({ run, key, group: groupOf(run, key) })
    }
  }
  if (pairs.length === 0) {
    const what = view.metrics ?? spec.metrics
    return {
      series: [],
      groups: [],
      runs: chosen.map((r) => r.name),
      keys,
      empty: `No metric matches ${Array.isArray(what) ? what.join(', ') : what} in these runs.`,
    }
  }

  const keyOrder = new Map(keys.map((k, i) => [k, i]))
  const runOrder = new Map(chosen.map((r, i) => [r.name, i]))
  const groups = [...new Set(pairs.map((p) => p.group))]
  if (groupBy.startsWith('config:') || groupBy.startsWith('run:')) groups.sort(naturalCompare)
  else {
    // Keep the data's order for runs and the selector's order for keys.
    const at = (g: string) => (groupBy === 'metric' ? keyOrder.get(g) : runOrder.get(g)) ?? 0
    groups.sort((a, b) => at(a) - at(b))
  }
  const groupIndex = new Map(groups.map((g, i) => [g, i]))
  pairs.sort(
    (a, b) =>
      groupIndex.get(a.group)! - groupIndex.get(b.group)! ||
      runOrder.get(a.run.name)! - runOrder.get(b.run.name)! ||
      keyOrder.get(a.key)! - keyOrder.get(b.key)!,
  )

  const usedKeys = [...new Set(pairs.map((p) => p.key))]
  const usedRuns = [...new Set(pairs.map((p) => p.run.name))]
  const template = view.legend ?? defaultLegend(groupBy, usedRuns.length, usedKeys.length)
  const dashFor = (key: string) =>
    groupBy === 'metric' || usedKeys.length < 2 ? 0 : usedKeys.indexOf(key)

  const members = new Map<string, string[]>()
  for (const pair of pairs) {
    const list = members.get(pair.group) ?? []
    if (!list.includes(pair.run.name)) list.push(pair.run.name)
    members.set(pair.group, list)
  }

  const series = pairs.map(({ run, key, group }) => {
    const list = members.get(group)!
    const shaded = groupBy !== 'run' && groupBy !== 'none'
    return {
      id: `${run.name}\u0000${key}`,
      run: run.name,
      key,
      group,
      label: fillLegend(template, { run: run.name, metric: key, group }, run.config),
      metadata: null,
      description: describe(key),
      style: null,
      groupIndex: groupIndex.get(group)!,
      shade: shaded ? list.indexOf(run.name) : 0,
      shadeCount: shaded ? list.length : 1,
      dash: dashFor(key),
    }
  })
  return { series, groups, runs: usedRuns, keys: usedKeys, empty: null }
}

function groupFunction(groupBy: string): (run: RunInfo, key: string) => string {
  if (groupBy === 'metric') return (_run, key) => key
  if (groupBy === 'none') return (run, key) => `${run.name}\u0000${key}`
  if (groupBy.startsWith('config:')) {
    const path = groupBy.slice('config:'.length)
    return (run) => {
      const value = run.config[path]
      return value === undefined ? '(unset)' : String(value)
    }
  }
  if (groupBy.startsWith('run:')) {
    const regex = compilePattern(groupBy.slice('run:'.length), 'group_by')
    return (run) => {
      const match = regex.exec(run.name)
      if (!match) return '(other)'
      return match[1] ?? match[0]
    }
  }
  return (run) => run.name
}

function defaultLegend(groupBy: string, runCount: number, keyCount: number): string {
  if (groupBy.startsWith('config:') || groupBy.startsWith('run:')) {
    return keyCount > 1 ? '{group}: {run} · {metric}' : '{group}: {run}'
  }
  if (runCount > 1 && keyCount > 1) return '{run} · {metric}'
  if (runCount > 1) return '{run}'
  return '{metric}'
}

function resolveItems(
  items: PlotItem[],
  runs: RunInfo[],
  byName: Map<string, RunInfo>,
  describe: (key: string) => string | null,
): Resolution {
  const series: ResolvedSeries[] = []
  const missing: string[] = []
  items.forEach((item, index) => {
    const matched = item.run !== undefined
      ? (byName.has(item.run) ? [byName.get(item.run)!] : [])
      : runs.filter((r) => compilePattern(item.run_regex!, 'run_regex').test(r.name))
    const withKey = matched.filter((r) => r.keys.some((k) => k.key === item.metric))
    if (withKey.length === 0) {
      missing.push(`${item.run ?? item.run_regex} · ${item.metric}`)
      return
    }
    for (const run of withKey) {
      const base = item.legend_name ?? `${run.name} · ${item.metric}`
      series.push({
        id: `${index}\u0000${run.name}\u0000${item.metric}`,
        run: run.name,
        key: item.metric,
        group: `${index}\u0000${run.name}`,
        label: item.run_regex && item.legend_name ? `${base} (${run.name})` : base,
        metadata: item.metadata ?? null,
        description: item.description ?? describe(item.metric),
        style: item.style ?? null,
        groupIndex: series.length,
        shade: 0,
        shadeCount: 1,
        dash: 0,
      })
    }
  })
  const groups = series.map((s) => s.group)
  return {
    series,
    groups,
    runs: [...new Set(series.map((s) => s.run))],
    keys: [...new Set(series.map((s) => s.key))],
    empty: series.length === 0 ? `None of the listed series exist: ${missing.join('; ')}.` : null,
  }
}
