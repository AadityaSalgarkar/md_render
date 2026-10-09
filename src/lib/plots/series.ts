/**
 * Numeric transforms between the backend's series and a chart: smoothing,
 * x-axis modes, summaries, histogram bins, normalisation and scatter points.
 * Pure functions only.
 */

import type { Point, Series, Summary } from './types'
import type { SummaryStat } from './schema'

/**
 * TensorBoard's smoothing: an exponential moving average with debiasing, so
 * the first points are not pulled towards zero. `weight` 0 returns the input.
 */
export function ema(values: number[], weight: number): number[] {
  if (weight <= 0) return [...values]
  let last = 0
  let steps = 0
  return values.map((value) => {
    steps += 1
    last = last * weight + (1 - weight) * value
    return last / (1 - weight ** steps)
  })
}

export type XAxisMode = 'step' | 'time' | 'relative'

/**
 * The x value of a point: its step, its wall-clock time in ms, or seconds
 * since the run's first row. Null when the mode needs a time it lacks.
 */
export function xOf(point: Point, mode: XAxisMode, t0: number | null): number | null {
  if (mode === 'step') return point[0]
  const t = point[2]
  if (t === null) return null
  if (mode === 'time') return t
  return t0 === null ? null : (t - t0) / 1000
}

/** Which direction is better for a key: lower for losses and errors. */
export function betterFor(key: string): 'min' | 'max' {
  return /loss|err|perplexity|ppl|bpb|bits|mse|mae|rmse|wer|cer|nll/i.test(key) ? 'min' : 'max'
}

/** One number from a summary. "best" follows `better` (auto from the key's name). */
export function reduce(
  summary: Summary | null,
  stat: SummaryStat,
  better: 'auto' | 'min' | 'max',
  key: string,
): number | null {
  if (!summary) return null
  if (stat === 'best') {
    const direction = better === 'auto' ? betterFor(key) : better
    return direction === 'min' ? summary.min : summary.max
  }
  return summary[stat]
}

export function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return null
  return finite.reduce((a, b) => a + b, 0) / finite.length
}

export interface Histogram {
  edges: number[]
  /** One count (or density) list per input. */
  counts: number[][]
}

/** Bins shared by every input so their bars line up. */
export function histogram(inputs: number[][], bins: number, density: boolean): Histogram {
  const all = inputs.flat().filter(Number.isFinite)
  if (all.length === 0) return { edges: [], counts: inputs.map(() => []) }
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (lo === hi) {
    lo -= 0.5
    hi += 0.5
  }
  const width = (hi - lo) / bins
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width)
  const counts = inputs.map((values) => {
    const row = new Array<number>(bins).fill(0)
    let n = 0
    for (const v of values) {
      if (!Number.isFinite(v)) continue
      const index = Math.min(bins - 1, Math.floor((v - lo) / width))
      row[index] += 1
      n += 1
    }
    return density && n > 0 ? row.map((c) => c / n) : row
  })
  return { edges, counts }
}

/**
 * Scale each axis (column) of a matrix to [0, 1] across its rows. A column
 * with a single value maps to 0.5. Missing values stay null.
 */
export function minmaxColumns(matrix: Array<Array<number | null>>): Array<Array<number | null>> {
  if (matrix.length === 0) return []
  const columns = matrix[0].length
  const bounds = Array.from({ length: columns }, (_, c) => {
    const values = matrix.map((row) => row[c]).filter((v): v is number => v !== null)
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0]
  })
  return matrix.map((row) =>
    row.map((v, c) => {
      if (v === null) return null
      const [lo, hi] = bounds[c]
      return hi === lo ? 0.5 : (v - lo) / (hi - lo)
    }),
  )
}

/** Whether spider axes differ in scale enough to need normalising. */
export function needsNormalising(matrix: Array<Array<number | null>>): boolean {
  const magnitudes: number[] = []
  if (matrix.length === 0) return false
  for (let c = 0; c < matrix[0].length; c += 1) {
    const values = matrix.map((r) => r[c]).filter((v): v is number => v !== null)
    if (values.length) magnitudes.push(Math.max(...values.map(Math.abs)))
  }
  const positive = magnitudes.filter((m) => m > 0)
  if (positive.length < 2) return false
  return Math.max(...positive) / Math.min(...positive) > 10
}

/** Keyed lookup of series by run and key. */
export function seriesIndex(series: Series[]): Map<string, Series> {
  return new Map(series.map((s) => [`${s.run}\u0000${s.key}`, s]))
}

export function seriesKey(run: string, key: string): string {
  return `${run}\u0000${key}`
}

export interface ScatterPoint {
  x: number
  y: number
  run: string
  step: number | null
}

/**
 * Scatter points for one run. `per: "run"` gives one point: x from a config
 * value or a summarised metric, y summarised. `per: "step"` joins the two
 * metrics on step, one point per step both were logged at.
 */
export function scatterPoints(
  run: string,
  config: Record<string, unknown>,
  x: string,
  y: string,
  per: 'run' | 'step',
  lookup: Map<string, Series>,
  stat: SummaryStat,
  better: 'auto' | 'min' | 'max',
): ScatterPoint[] {
  const ySeries = lookup.get(seriesKey(run, y))
  if (!ySeries) return []
  if (per === 'step') {
    if (x.startsWith('config:')) return []
    const xSeries = lookup.get(seriesKey(run, x))
    if (!xSeries) return []
    const xs = new Map(xSeries.points.map((p) => [p[0], p[1]]))
    return ySeries.points
      .filter((p) => xs.has(p[0]))
      .map((p) => ({ x: xs.get(p[0])!, y: p[1], run, step: p[0] }))
  }
  const yValue = reduce(ySeries.summary, stat, better, y)
  let xValue: number | null
  if (x.startsWith('config:')) {
    const raw = config[x.slice('config:'.length)]
    xValue = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : null
  } else {
    const xSeries = lookup.get(seriesKey(run, x))
    xValue = xSeries ? reduce(xSeries.summary, stat, better, x) : null
  }
  if (yValue === null || xValue === null || !Number.isFinite(xValue)) return []
  return [{ x: xValue, y: yValue, run, step: null }]
}

/** Short, readable numbers for ticks, tooltips and the table. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return value.toExponential(2)
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return Number(value.toPrecision(4)).toString()
}

/** "1:02:03" or "2:03" for elapsed seconds. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
