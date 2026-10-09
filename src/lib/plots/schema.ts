/**
 * The `<plot>` block: JSON written in the markdown, parsed and filled with
 * defaults here. Nothing in this module touches the DOM or the network.
 */

import type { DbSource } from './types'

export const PLOT_TYPES = ['line', 'bar', 'spider', 'histogram', 'scatter'] as const
export type PlotType = (typeof PLOT_TYPES)[number]

const TYPE_ALIASES: Record<string, PlotType> = {
  line: 'line',
  'line-graph': 'line',
  'line-plot': 'line',
  linegraph: 'line',
  bar: 'bar',
  'bar-chart': 'bar',
  spider: 'spider',
  radar: 'spider',
  histogram: 'histogram',
  hist: 'histogram',
  scatter: 'scatter',
  'scatter-plot': 'scatter',
}

export const DASH_STYLES = ['solid', 'dashed', 'dotted', 'dash-dot'] as const
export type DashStyle = (typeof DASH_STYLES)[number]

export const SUMMARIES = ['last', 'best', 'min', 'max', 'mean', 'first'] as const
export type SummaryStat = (typeof SUMMARIES)[number]

/** A run or metric selection: one regex, or a list of exact names. */
export type Selector = string | string[]

export interface ItemStyle {
  color?: string
  dash?: DashStyle
  width?: number
  points?: boolean
}

export interface PlotItem {
  run?: string
  run_regex?: string
  metric: string
  legend_name?: string
  metadata?: string
  description?: string
  style?: ItemStyle
}

export interface AxisX {
  axis: 'step' | 'time' | 'relative'
  range: [number | null, number | null]
  label: string | null
}

export interface AxisY {
  scale: 'linear' | 'log'
  smoothing: number
  show_raw: boolean
  range: [number | null, number | null]
  label: string | null
}

export interface ViewSpec {
  name: string
  runs?: Selector
  metrics?: Selector
  /** "run" | "metric" | "none" | "config:<dotpath>" | "run:<regex>" */
  group_by?: string
  legend?: string
  x?: Partial<AxisX>
  y?: Partial<AxisY>
}

export interface ScatterSpec {
  /** A metric key, or "config:<dotpath>". */
  x: string
  /** A metric key. */
  y: string
  per: 'run' | 'step'
  log_x: boolean
  labels: 'hover' | 'always'
}

export interface PlotSpec {
  plot_type: PlotType
  source: DbSource
  runs: Selector
  metrics: Selector
  descriptions: Record<string, string>
  items: PlotItem[]
  views: ViewSpec[]
  default_view: string | null
  x: AxisX
  y: AxisY
  dedupe_steps: 'last' | 'none'
  summary: SummaryStat
  better: 'auto' | 'min' | 'max'
  normalize: 'auto' | 'none' | 'minmax'
  bins: number
  density: boolean
  scatter: ScatterSpec | null
  max_points: number
  /** "auto", or seconds between polls (0 never polls). */
  refresh: 'auto' | number
  title: string
  /** The lesson the plot shows, printed under it as "Figure N: …". */
  caption: string
  height: number
  legend: 'auto' | 'bottom' | 'right' | 'none'
  /**
   * The per-series summary table under the chart: "auto" shows it up to
   * MAX_TABLE_ROWS rows, true always, false never.
   */
  table: 'auto' | boolean
  id: string | null
}

/** Most rows the summary table shows by itself; `"table": true` lifts the limit. */
export const MAX_TABLE_ROWS = 150

/** Whether a plot shows its summary table, given the block setting and the row count. */
export function showsTable(setting: PlotSpec['table'], rows: number): boolean {
  if (setting === 'auto') return rows > 0 && rows <= MAX_TABLE_ROWS
  return setting
}

export type ParseResult =
  | { ok: true; spec: PlotSpec; warnings: string[] }
  | { ok: false; error: string }

/** Longest regex accepted from a document; bounds the cost of a bad pattern. */
export const MAX_PATTERN_LENGTH = 200

const KNOWN_KEYS = new Set([
  'plot_type', 'type', 'source', 'runs', 'metrics', 'descriptions', 'items', 'views',
  'default_view', 'x', 'y', 'dedupe_steps', 'summary', 'better', 'normalize', 'bins',
  'density', 'scatter', 'max_points', 'refresh', 'title', 'caption', 'height', 'legend', 'table', 'id',
])

class SpecError extends Error {}

function tableSetting(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new SpecError('"table" must be true, false or "auto"')
  return value
}

/** Compile a regex from the document, or explain why it cannot be used. */
export function compilePattern(pattern: string, where: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new SpecError(`${where}: the pattern is longer than ${MAX_PATTERN_LENGTH} characters`)
  }
  try {
    return new RegExp(pattern, 'u')
  } catch (err) {
    throw new SpecError(`${where}: ${(err as Error).message}`)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new SpecError(`${where} must be a string`)
  return value
}

function oneOf<T extends string>(value: unknown, options: readonly T[], where: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) {
    throw new SpecError(`${where} must be one of ${options.map((o) => `"${o}"`).join(', ')}`)
  }
  return value as T
}

function num(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SpecError(`${where} must be a number`)
  }
  if (value < min || value > max) throw new SpecError(`${where} must be between ${min} and ${max}`)
  return value
}

function selector(value: unknown, where: string): Selector {
  if (typeof value === 'string') {
    compilePattern(value, where)
    return value
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[]
  throw new SpecError(`${where} must be a regex string or a list of exact names`)
}

function range(value: unknown, where: string): [number | null, number | null] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new SpecError(`${where} must be [min, max] (null for automatic)`)
  }
  return value.map((v, i) => {
    if (v === null) return null
    return num(v, `${where}[${i}]`, -Number.MAX_VALUE, Number.MAX_VALUE)
  }) as [number | null, number | null]
}

/** Check a group_by value: "run", "metric", "none", "config:<path>", "run:<regex>". */
export function checkGroupBy(value: unknown, where: string): string {
  const text = str(value, where)
  if (text === 'run' || text === 'metric' || text === 'none') return text
  if (text.startsWith('config:') && text.length > 'config:'.length) return text
  if (text.startsWith('run:') && text.length > 'run:'.length) {
    compilePattern(text.slice(4), where)
    return text
  }
  throw new SpecError(
    `${where} must be "run", "metric", "none", "config:<dotpath>" or "run:<regex>"`,
  )
}

function partialX(value: unknown, where: string): Partial<AxisX> {
  if (!isObject(value)) throw new SpecError(`${where} must be an object`)
  const out: Partial<AxisX> = {}
  if (value.axis !== undefined) out.axis = oneOf(value.axis, ['step', 'time', 'relative'] as const, `${where}.axis`)
  if (value.range !== undefined) out.range = range(value.range, `${where}.range`)
  if (value.label !== undefined) out.label = value.label === null ? null : str(value.label, `${where}.label`)
  return out
}

function partialY(value: unknown, where: string): Partial<AxisY> {
  if (!isObject(value)) throw new SpecError(`${where} must be an object`)
  const out: Partial<AxisY> = {}
  if (value.scale !== undefined) out.scale = oneOf(value.scale, ['linear', 'log'] as const, `${where}.scale`)
  if (value.smoothing !== undefined) out.smoothing = num(value.smoothing, `${where}.smoothing`, 0, 0.99)
  if (value.show_raw !== undefined) {
    if (typeof value.show_raw !== 'boolean') throw new SpecError(`${where}.show_raw must be true or false`)
    out.show_raw = value.show_raw
  }
  if (value.range !== undefined) out.range = range(value.range, `${where}.range`)
  if (value.label !== undefined) out.label = value.label === null ? null : str(value.label, `${where}.label`)
  return out
}

function parseStyle(value: unknown, where: string): ItemStyle {
  if (!isObject(value)) throw new SpecError(`${where} must be an object`)
  const style: ItemStyle = {}
  if (value.color !== undefined) style.color = str(value.color, `${where}.color`)
  if (value.dash !== undefined) style.dash = oneOf(value.dash, DASH_STYLES, `${where}.dash`)
  if (value.width !== undefined) style.width = num(value.width, `${where}.width`, 0.5, 6)
  if (value.points !== undefined) style.points = Boolean(value.points)
  return style
}

function parseItem(value: unknown, where: string): PlotItem {
  if (!isObject(value)) throw new SpecError(`${where} must be an object`)
  if (value.metric === undefined) throw new SpecError(`${where} needs a "metric"`)
  const item: PlotItem = { metric: str(value.metric, `${where}.metric`) }
  if (value.run !== undefined) item.run = str(value.run, `${where}.run`)
  if (value.run_regex !== undefined) {
    item.run_regex = str(value.run_regex, `${where}.run_regex`)
    compilePattern(item.run_regex, `${where}.run_regex`)
  }
  if (item.run === undefined && item.run_regex === undefined) {
    throw new SpecError(`${where} needs a "run" (or "run_regex")`)
  }
  for (const field of ['legend_name', 'metadata', 'description'] as const) {
    if (value[field] !== undefined && value[field] !== null) item[field] = str(value[field], `${where}.${field}`)
  }
  if (value.style !== undefined) item.style = parseStyle(value.style, `${where}.style`)
  return item
}

function parseView(value: unknown, where: string): ViewSpec {
  if (!isObject(value)) throw new SpecError(`${where} must be an object`)
  const view: ViewSpec = { name: str(value.name, `${where}.name`) }
  if (!view.name.trim()) throw new SpecError(`${where}.name must not be empty`)
  if (value.runs !== undefined) view.runs = selector(value.runs, `${where}.runs`)
  if (value.metrics !== undefined) view.metrics = selector(value.metrics, `${where}.metrics`)
  if (value.group_by !== undefined) view.group_by = checkGroupBy(value.group_by, `${where}.group_by`)
  if (value.legend !== undefined) view.legend = str(value.legend, `${where}.legend`)
  if (value.x !== undefined) view.x = partialX(value.x, `${where}.x`)
  if (value.y !== undefined) view.y = partialY(value.y, `${where}.y`)
  return view
}

function parseSource(value: unknown): DbSource {
  if (!isObject(value)) {
    throw new SpecError('"source" must be {"project": NAME} or {"db": PATH}')
  }
  const hasProject = value.project !== undefined
  const hasDb = value.db !== undefined
  if (hasProject === hasDb) {
    throw new SpecError('"source" needs exactly one of "project" or "db"')
  }
  return hasProject
    ? { project: str(value.project, 'source.project') }
    : { db: str(value.db, 'source.db') }
}

function parseScatter(value: unknown): ScatterSpec {
  if (!isObject(value)) throw new SpecError('"scatter" must be an object with "x" and "y"')
  const x = str(value.x, 'scatter.x')
  const y = str(value.y, 'scatter.y')
  return {
    x,
    y,
    per: value.per === undefined ? 'run' : oneOf(value.per, ['run', 'step'], 'scatter.per'),
    log_x: value.log_x === undefined ? false : Boolean(value.log_x),
    labels: value.labels === undefined ? 'hover' : oneOf(value.labels, ['hover', 'always'], 'scatter.labels'),
  }
}

export const DEFAULT_X: AxisX = { axis: 'step', range: [null, null], label: null }
export const DEFAULT_Y: AxisY = {
  scale: 'linear',
  smoothing: 0,
  show_raw: true,
  range: [null, null],
  label: null,
}

/** Normalise a plot type name, accepting the aliases authors reach for. */
export function normalisePlotType(value: unknown): PlotType | null {
  if (typeof value !== 'string') return null
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? null
}

/** Parse a block's JSON text into a complete spec, or an error to show. */
export function parsePlotBlock(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `The plot block is not valid JSON: ${(err as Error).message}` }
  }
  try {
    return { ok: true, ...parseSpec(raw) }
  } catch (err) {
    if (err instanceof SpecError) return { ok: false, error: err.message }
    throw err
  }
}

function parseSpec(raw: unknown): { spec: PlotSpec; warnings: string[] } {
  if (!isObject(raw)) throw new SpecError('The plot block must be a JSON object')
  const warnings: string[] = []
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`unknown field "${key}" ignored`)
  }

  const typeValue = raw.plot_type ?? raw.type
  if (typeValue === undefined) throw new SpecError('The plot block needs "plot_type"')
  const plotType = normalisePlotType(typeValue)
  if (!plotType) {
    throw new SpecError(
      `"plot_type" must be one of ${PLOT_TYPES.map((t) => `"${t}"`).join(', ')} (got ${JSON.stringify(typeValue)})`,
    )
  }
  if (raw.source === undefined) throw new SpecError('The plot block needs "source"')

  const spec: PlotSpec = {
    plot_type: plotType,
    source: parseSource(raw.source),
    runs: raw.runs === undefined ? '.*' : selector(raw.runs, '"runs"'),
    metrics: raw.metrics === undefined ? '.*' : selector(raw.metrics, '"metrics"'),
    descriptions: {},
    items: [],
    views: [],
    default_view: null,
    x: { ...DEFAULT_X, ...(raw.x === undefined ? {} : partialX(raw.x, '"x"')) },
    y: { ...DEFAULT_Y, ...(raw.y === undefined ? {} : partialY(raw.y, '"y"')) },
    dedupe_steps: raw.dedupe_steps === undefined ? 'last' : oneOf(raw.dedupe_steps, ['last', 'none'], '"dedupe_steps"'),
    summary: raw.summary === undefined ? 'last' : oneOf(raw.summary, SUMMARIES, '"summary"'),
    better: raw.better === undefined ? 'auto' : oneOf(raw.better, ['auto', 'min', 'max'], '"better"'),
    normalize: raw.normalize === undefined ? 'auto' : oneOf(raw.normalize, ['auto', 'none', 'minmax'], '"normalize"'),
    bins: raw.bins === undefined ? 30 : Math.round(num(raw.bins, '"bins"', 2, 200)),
    density: raw.density === undefined ? false : Boolean(raw.density),
    scatter: null,
    max_points: raw.max_points === undefined ? 1500 : Math.round(num(raw.max_points, '"max_points"', 0, 20000)),
    refresh: 'auto',
    title: raw.title === undefined ? '' : str(raw.title, '"title"'),
    caption: raw.caption === undefined || raw.caption === null ? '' : str(raw.caption, '"caption"').trim(),
    height: raw.height === undefined ? 320 : Math.round(num(raw.height, '"height"', 160, 1200)),
    legend: raw.legend === undefined ? 'auto' : oneOf(raw.legend, ['auto', 'bottom', 'right', 'none'], '"legend"'),
    table: raw.table === undefined || raw.table === 'auto' ? 'auto' : tableSetting(raw.table),
    id: raw.id === undefined || raw.id === null ? null : str(raw.id, '"id"'),
  }

  if (raw.descriptions !== undefined) {
    if (!isObject(raw.descriptions)) throw new SpecError('"descriptions" must map metric keys or globs to text')
    for (const [key, value] of Object.entries(raw.descriptions)) {
      spec.descriptions[key] = str(value, `descriptions["${key}"]`)
    }
  }
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items)) throw new SpecError('"items" must be a list')
    spec.items = raw.items.map((item, i) => parseItem(item, `items[${i}]`))
  }
  if (raw.views !== undefined) {
    if (!Array.isArray(raw.views)) throw new SpecError('"views" must be a list')
    spec.views = raw.views.map((view, i) => parseView(view, `views[${i}]`))
    const names = new Set<string>()
    for (const view of spec.views) {
      if (names.has(view.name)) throw new SpecError(`two views are named "${view.name}"`)
      names.add(view.name)
    }
  }
  if (raw.default_view !== undefined && raw.default_view !== null) {
    spec.default_view = str(raw.default_view, '"default_view"')
  }
  if (raw.refresh !== undefined) {
    if (raw.refresh === 'auto') spec.refresh = 'auto'
    else {
      const seconds = num(raw.refresh, '"refresh"', 0, 86_400)
      if (seconds > 0 && seconds < 2) throw new SpecError('"refresh" must be 0 or at least 2 seconds')
      spec.refresh = seconds
    }
  }
  if (plotType === 'scatter') {
    if (raw.scatter === undefined) throw new SpecError('a scatter plot needs "scatter": {"x": ..., "y": ...}')
    spec.scatter = parseScatter(raw.scatter)
  } else if (raw.scatter !== undefined) {
    warnings.push('"scatter" only applies to scatter plots')
  }
  if (plotType !== 'line' && spec.y.smoothing > 0) warnings.push('smoothing only applies to line plots')
  return { spec, warnings }
}
