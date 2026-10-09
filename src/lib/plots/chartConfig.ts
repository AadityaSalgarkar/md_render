/**
 * Pure builders from a plot block, a resolved view, fetched series and the
 * theme palette to a Chart.js configuration, plus the HTML legend entries
 * and the data table that sit beside the canvas. No DOM access: the
 * component supplies the palette and owns the chart instance.
 */

import type { ChartConfiguration, Plugin, TooltipItem } from 'chart.js'
import type { AxisX, AxisY, PlotSpec } from './schema'
import type { Resolution, ResolvedSeries, View } from './views'
import type { RunInfo, Series } from './types'
import {
  DASH_PATTERNS,
  dashFor,
  groupColor,
  shade,
  withAlpha,
  type Palette,
} from './palette'
import {
  ema,
  formatElapsed,
  formatNumber,
  histogram,
  mean,
  minmaxColumns,
  needsNormalising,
  reduce,
  scatterPoints,
  seriesKey,
  xOf,
  type XAxisMode,
} from './series'

export interface LegendEntry {
  id: string
  label: string
  color: string
  dash: number[]
  /** The metric key behind the entry, when it is about one key. */
  key: string | null
  description: string | null
  hidden: boolean
}

export interface TableRow {
  id: string
  label: string
  group: string
  run: string
  key: string
  description: string | null
  n: number
  last: number | null
  min: number | null
  max: number | null
  mean: number | null
}

export interface BuiltChart {
  config: ChartConfiguration
  legend: LegendEntry[]
  table: TableRow[]
  notes: string[]
}

/** Settings the reader changes from the toolbar, on top of the block's. */
export interface Overrides {
  axis?: XAxisMode
  scale?: 'linear' | 'log'
  smoothing?: number
}

export interface BuildInput {
  spec: PlotSpec
  view: View
  resolution: Resolution
  series: Map<string, Series>
  runs: RunInfo[]
  palette: Palette
  hidden: Set<string>
  overrides?: Overrides
}

/** The block's axes with the view's and then the reader's overrides applied. */
export function effectiveAxes(spec: PlotSpec, view: View, overrides: Overrides = {}): { x: AxisX; y: AxisY } {
  const x = { ...spec.x, ...view.x }
  const y = { ...spec.y, ...view.y }
  if (overrides.axis) x.axis = overrides.axis
  if (overrides.scale) y.scale = overrides.scale
  if (overrides.smoothing !== undefined) y.smoothing = overrides.smoothing
  return { x, y }
}

export function seriesColor(s: ResolvedSeries, palette: Palette): string {
  return s.style?.color ?? shade(groupColor(palette, s.groupIndex), s.shade, s.shadeCount)
}

function seriesDash(s: ResolvedSeries): number[] {
  return DASH_PATTERNS[s.style?.dash ?? dashFor(s.dash)]
}

function tableRows(resolution: Resolution, data: Map<string, Series>, hidden: Set<string>, legendIdOf: (s: ResolvedSeries) => string): TableRow[] {
  return resolution.series
    .filter((s) => !hidden.has(legendIdOf(s)))
    .map((s) => {
      const found = data.get(seriesKey(s.run, s.key))
      const summary = found?.summary ?? null
      return {
        id: s.id,
        label: s.label,
        group: s.group.includes('\u0000') ? '' : s.group,
        run: s.run,
        key: s.key,
        description: s.description,
        n: found?.n ?? 0,
        last: summary?.last ?? null,
        min: summary?.min ?? null,
        max: summary?.max ?? null,
        mean: summary?.mean ?? null,
      }
    })
}

function baseOptions(palette: Palette) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    color: palette.text,
    font: { family: palette.font, size: 12 },
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        backgroundColor: palette.surface,
        titleColor: palette.text,
        bodyColor: palette.text,
        footerColor: palette.muted,
        borderColor: palette.grid,
        borderWidth: 1,
        padding: 8,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { family: palette.font, weight: 'normal' as const },
        bodyFont: { family: palette.font },
        footerFont: { family: palette.font, size: 11, style: 'italic' as const, weight: 'normal' as const },
      },
    },
  }
}

function linearScale(palette: Palette, label: string | null, log: boolean, range: [number | null, number | null]) {
  return {
    type: log ? ('logarithmic' as const) : ('linear' as const),
    min: range[0] ?? undefined,
    max: range[1] ?? undefined,
    title: { display: Boolean(label), text: label ?? '', color: palette.muted, font: { family: palette.font } },
    grid: { color: withAlpha(palette.grid, 0.7), drawTicks: false },
    border: { color: palette.grid },
    ticks: { color: palette.muted, padding: 6, font: { family: palette.font, size: 11 } },
  }
}

/**
 * Tick labels: readable numbers, and on a log axis only the 1, 2 and 5
 * multiples of each power of ten, so the labels do not pile up.
 */
export function numberTicks(log: boolean) {
  return (value: string | number): string => {
    const v = Number(value)
    if (log && v > 0) {
      const mantissa = v / 10 ** Math.floor(Math.log10(v) + 1e-9)
      if (![1, 2, 5].some((k) => Math.abs(mantissa - k) < 1e-6)) return ''
    }
    return formatNumber(v)
  }
}

/** Legend ids: a series' own id, or its group for kinds drawn per group. */
const bySeries = (s: ResolvedSeries) => s.id
const byGroup = (s: ResolvedSeries) => s.group

export function buildChart(input: BuildInput): BuiltChart {
  switch (input.spec.plot_type) {
    case 'line':
      return buildLine(input)
    case 'bar':
      return buildBar(input)
    case 'spider':
      return buildSpider(input)
    case 'histogram':
      return buildHistogram(input)
    case 'scatter':
      return buildScatter(input)
  }
}

// ---- line ------------------------------------------------------------------

interface LineMeta {
  series: ResolvedSeries
  raw: boolean
  steps: number[]
}

function xLabel(axis: AxisX): string {
  if (axis.label) return axis.label
  return axis.axis === 'step' ? 'step' : axis.axis === 'time' ? 'time' : 'elapsed'
}

function formatX(value: number, mode: XAxisMode): string {
  if (mode === 'time') {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  if (mode === 'relative') return formatElapsed(value)
  return formatNumber(value)
}

function buildLine(input: BuildInput): BuiltChart {
  const { spec, view, resolution, series: data, runs, palette, hidden } = input
  const { x, y } = effectiveAxes(spec, view, input.overrides)
  const t0 = new Map(runs.map((r) => [r.name, r.first_ms]))
  const log = y.scale === 'log'
  const notes: string[] = []
  let droppedNonPositive = 0
  let downsampled = 0

  const datasets: ChartConfiguration<'line'>['data']['datasets'] = []
  const meta: LineMeta[] = []
  const legend: LegendEntry[] = []

  for (const s of resolution.series) {
    const found = data.get(seriesKey(s.run, s.key))
    const color = seriesColor(s, palette)
    const dash = seriesDash(s)
    const isHidden = hidden.has(s.id)
    legend.push({ id: s.id, label: s.label, color, dash, key: s.key, description: s.description, hidden: isHidden })
    if (!found) continue
    if (found.downsampled) downsampled += 1

    const xs: number[] = []
    const ys: number[] = []
    const steps: number[] = []
    for (const point of found.points) {
      const xv = xOf(point, x.axis, t0.get(s.run) ?? null)
      if (xv === null) continue
      if (log && point[1] <= 0) {
        droppedNonPositive += 1
        continue
      }
      xs.push(xv)
      ys.push(point[1])
      steps.push(point[0])
    }
    const smoothed = y.smoothing > 0 ? ema(ys, y.smoothing) : ys
    const width = s.style?.width ?? 1.75
    const points = s.style?.points ?? false

    if (y.smoothing > 0 && y.show_raw) {
      datasets.push({
        label: s.label,
        data: xs.map((xv, i) => ({ x: xv, y: ys[i] })),
        borderColor: withAlpha(color, 0.25),
        backgroundColor: withAlpha(color, 0.25),
        borderWidth: 1,
        borderDash: dash,
        pointRadius: 0,
        pointHoverRadius: 0,
        hidden: isHidden,
        order: 2,
      })
      meta.push({ series: s, raw: true, steps })
    }
    datasets.push({
      label: s.label,
      data: xs.map((xv, i) => ({ x: xv, y: smoothed[i] })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: width,
      borderDash: dash,
      pointRadius: points ? 2.5 : 0,
      pointHoverRadius: 3.5,
      tension: 0,
      hidden: isHidden,
      order: 1,
    })
    meta.push({ series: s, raw: false, steps })
  }

  if (droppedNonPositive) notes.push(`${droppedNonPositive} values at or below zero are not drawn on the log scale.`)
  if (downsampled) notes.push(`Long series are downsampled to ${spec.max_points} points; summaries use every point.`)

  const base = baseOptions(palette)
  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: { datasets },
    options: {
      ...base,
      parsing: false,
      normalized: true,
      spanGaps: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: {
          ...linearScale(palette, xLabel(x), false, x.range),
          ticks: {
            ...linearScale(palette, null, false, x.range).ticks,
            maxTicksLimit: 8,
            callback: (value) => formatX(Number(value), x.axis),
          },
        },
        y: {
          ...linearScale(palette, y.label, log, y.range),
          ticks: { ...linearScale(palette, null, log, y.range).ticks, callback: numberTicks(log) },
        },
      },
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          filter: (item: TooltipItem<'line'>) => !meta[item.datasetIndex]?.raw,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => {
              const item = items[0]
              if (!item) return ''
              const m = meta[item.datasetIndex]
              const step = m?.steps[item.dataIndex]
              const xText = formatX(item.parsed.x ?? 0, x.axis)
              return x.axis === 'step' ? `step ${xText}` : `${xText} · step ${formatNumber(step)}`
            },
            label: (item: TooltipItem<'line'>) =>
              `${meta[item.datasetIndex]?.series.label}: ${formatNumber(item.parsed.y)}`,
            afterLabel: (item: TooltipItem<'line'>) => meta[item.datasetIndex]?.series.metadata ?? '',
            footer: (items: TooltipItem<'line'>[]) => sharedDescription(items.map((i) => meta[i.datasetIndex]?.series)),
          },
        },
      },
    },
  }
  return {
    config: config as unknown as ChartConfiguration,
    legend,
    table: tableRows(resolution, data, hidden, bySeries),
    notes,
  }
}

/** The description of the hovered key, when every hovered series shares one. */
function sharedDescription(series: Array<ResolvedSeries | undefined>): string {
  const keys = new Set(series.filter(Boolean).map((s) => s!.key))
  if (keys.size !== 1) return ''
  return series.find(Boolean)?.description ?? ''
}

// ---- grouped summaries (bar, spider) ---------------------------------------

/** The label for a group: the series' own label when the group is one series. */
function groupLabel(view: View, members: ResolvedSeries[]): string {
  if (view.group_by === 'none' || view.items) return members[0].label
  return members[0].group
}

function groupMembers(resolution: Resolution): Map<string, ResolvedSeries[]> {
  const out = new Map<string, ResolvedSeries[]>()
  for (const s of resolution.series) out.set(s.group, [...(out.get(s.group) ?? []), s])
  return out
}

function summaryValue(input: BuildInput, members: ResolvedSeries[], key: string): number | null {
  const values = members
    .filter((s) => s.key === key)
    .map((s) => reduce(input.series.get(seriesKey(s.run, s.key))?.summary ?? null, input.spec.summary, input.spec.better, key))
    .filter((v): v is number => v !== null)
  return mean(values)
}

function buildBar(input: BuildInput): BuiltChart {
  const { spec, view, resolution, palette, hidden } = input
  const { y } = effectiveAxes(spec, view, input.overrides)
  const members = groupMembers(resolution)
  const groups = resolution.groups
  const keys = resolution.keys
  const legend: LegendEntry[] = []
  const base = baseOptions(palette)
  let datasets: ChartConfiguration<'bar'>['data']['datasets']
  let labels: string[]
  const memberNames = (group: string) => [...new Set((members.get(group) ?? []).map((s) => s.run))]
  const metaFor: Array<Array<{ group: string; key: string; metadata: string | null }>> = []

  if (keys.length === 1 || view.items) {
    // One bar per group, coloured by group; the legend toggles bars.
    const shown = groups.filter((g) => !hidden.has(g))
    for (const g of groups) {
      const first = members.get(g)![0]
      legend.push({
        id: g,
        label: groupLabel(view, members.get(g)!),
        color: seriesColor(first, palette),
        dash: [],
        key: keys.length === 1 ? keys[0] : first.key,
        description: first.description,
        hidden: hidden.has(g),
      })
    }
    labels = shown.map((g) => groupLabel(view, members.get(g)!))
    const colors = shown.map((g) => seriesColor(members.get(g)![0], palette))
    datasets = [
      {
        label: keys.length === 1 ? keys[0] : 'value',
        data: shown.map((g) => {
          const first = members.get(g)![0]
          return summaryValue(input, members.get(g)!, first.key)
        }),
        backgroundColor: colors.map((c) => withAlpha(c, 0.8)),
        borderColor: colors,
        borderWidth: 1,
      },
    ]
    metaFor.push(shown.map((g) => ({ group: g, key: members.get(g)![0].key, metadata: members.get(g)![0].metadata })))
  } else {
    // One dataset per key, bars grouped by group.
    labels = groups.map((g) => groupLabel(view, members.get(g)!))
    datasets = keys.map((key, i) => {
      const color = palette.series[i % palette.series.length]
      const description = resolution.series.find((s) => s.key === key)?.description ?? null
      legend.push({ id: key, label: key, color, dash: [], key, description, hidden: hidden.has(key) })
      metaFor.push(groups.map((g) => ({ group: g, key, metadata: null })))
      return {
        label: key,
        data: groups.map((g) => summaryValue(input, members.get(g)!, key)),
        backgroundColor: withAlpha(color, 0.8),
        borderColor: color,
        borderWidth: 1,
        hidden: hidden.has(key),
      }
    })
  }

  const config: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      ...base,
      scales: {
        x: {
          grid: { display: false },
          border: { color: palette.grid },
          ticks: { color: palette.muted, font: { family: palette.font, size: 11 } },
        },
        y: {
          ...linearScale(palette, y.label ?? spec.summary, y.scale === 'log', y.range),
          ticks: { ...linearScale(palette, null, y.scale === 'log', y.range).ticks, callback: numberTicks(y.scale === 'log') },
        },
      },
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            label: (item: TooltipItem<'bar'>) =>
              `${item.dataset.label}: ${formatNumber(item.parsed.y)} (${spec.summary})`,
            afterLabel: (item: TooltipItem<'bar'>) => {
              const m = metaFor[item.datasetIndex]?.[item.dataIndex]
              if (!m) return ''
              const runs = memberNames(m.group)
              const lines = runs.length > 1 ? [`mean of ${runs.join(', ')}`] : []
              if (m.metadata) lines.push(m.metadata)
              return lines
            },
            footer: (items: TooltipItem<'bar'>[]) => {
              const m = items[0] ? metaFor[items[0].datasetIndex]?.[items[0].dataIndex] : undefined
              return m ? (resolution.series.find((s) => s.key === m.key)?.description ?? '') : ''
            },
          },
        },
      },
    },
  }
  return {
    config: config as unknown as ChartConfiguration,
    legend,
    table: tableRows(resolution, input.series, hidden, keys.length === 1 || view.items ? byGroup : (s) => s.key),
    notes: [],
  }
}

function buildSpider(input: BuildInput): BuiltChart {
  const { spec, view, resolution, palette, hidden } = input
  const members = groupMembers(resolution)
  const keys = resolution.keys
  const groups = resolution.groups
  const raw = groups.map((g) => keys.map((k) => summaryValue(input, members.get(g)!, k)))
  const normalise = spec.normalize === 'minmax' || (spec.normalize === 'auto' && needsNormalising(raw))
  const values = normalise ? minmaxColumns(raw) : raw
  const describe = (key: string) => resolution.series.find((s) => s.key === key)?.description ?? ''
  const legend: LegendEntry[] = []
  const base = baseOptions(palette)

  const datasets = groups.map((g, i) => {
    const first = members.get(g)![0]
    const color = first.style?.color ?? groupColor(palette, i)
    legend.push({
      id: g,
      label: groupLabel(view, members.get(g)!),
      color,
      dash: [],
      key: null,
      description: null,
      hidden: hidden.has(g),
    })
    return {
      label: groupLabel(view, members.get(g)!),
      data: values[i],
      borderColor: color,
      backgroundColor: withAlpha(color, 0.12),
      pointBackgroundColor: color,
      borderWidth: 1.75,
      pointRadius: 2.5,
      hidden: hidden.has(g),
    }
  })

  const config: ChartConfiguration<'radar'> = {
    type: 'radar',
    data: { labels: keys, datasets },
    options: {
      ...base,
      scales: {
        r: {
          min: normalise ? 0 : undefined,
          max: normalise ? 1 : undefined,
          angleLines: { color: withAlpha(palette.grid, 0.8) },
          grid: { color: withAlpha(palette.grid, 0.8) },
          pointLabels: { color: palette.text, font: { family: palette.mono, size: 11 } },
          ticks: {
            display: !normalise,
            color: palette.muted,
            backdropColor: 'transparent',
            callback: (value) => formatNumber(Number(value)),
          },
        },
      },
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            title: (items: TooltipItem<'radar'>[]) => (items[0] ? keys[items[0].dataIndex] : ''),
            label: (item: TooltipItem<'radar'>) =>
              `${item.dataset.label}: ${formatNumber(raw[item.datasetIndex]?.[item.dataIndex])} (${spec.summary})`,
            footer: (items: TooltipItem<'radar'>[]) => (items[0] ? describe(keys[items[0].dataIndex]) : ''),
          },
        },
      },
    },
  }
  const notes = normalise ? ['Each axis is scaled to its own range; hover for the values.'] : []
  return {
    config: config as unknown as ChartConfiguration,
    legend,
    table: tableRows(resolution, input.series, hidden, byGroup),
    notes,
  }
}

// ---- histogram -------------------------------------------------------------

function buildHistogram(input: BuildInput): BuiltChart {
  const { spec, view, resolution, series: data, palette, hidden } = input
  const members = groupMembers(resolution)
  const groups = resolution.groups
  const pooled = groups.map((g) =>
    (members.get(g) ?? []).flatMap((s) => data.get(seriesKey(s.run, s.key))?.points.map((p) => p[1]) ?? []),
  )
  const hist = histogram(pooled, spec.bins, spec.density)
  const centers = hist.edges.slice(0, -1).map((lo, i) => (lo + hist.edges[i + 1]) / 2)
  const legend: LegendEntry[] = []
  const base = baseOptions(palette)
  const overlay = groups.length > 1

  const datasets = groups.map((g, i) => {
    const first = members.get(g)![0]
    const color = first.style?.color ?? groupColor(palette, i)
    const label = groupLabel(view, members.get(g)!)
    legend.push({ id: g, label, color, dash: [], key: first.key, description: first.description, hidden: hidden.has(g) })
    return {
      label,
      data: hist.counts[i],
      backgroundColor: withAlpha(color, overlay ? 0.45 : 0.75),
      borderColor: color,
      borderWidth: 1,
      barPercentage: 1,
      categoryPercentage: 1,
      grouped: false,
      hidden: hidden.has(g),
    }
  })

  const binText = (i: number) => `${formatNumber(hist.edges[i])} to ${formatNumber(hist.edges[i + 1])}`
  const config: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: { labels: centers.map((c) => formatNumber(Number(c.toPrecision(3)))), datasets },
    options: {
      ...base,
      scales: {
        x: {
          title: {
            display: true,
            text: spec.x.label ?? resolution.keys.join(', '),
            color: palette.muted,
            font: { family: palette.font },
          },
          grid: { display: false },
          border: { color: palette.grid },
          ticks: { color: palette.muted, maxTicksLimit: 10, font: { family: palette.font, size: 11 } },
        },
        y: linearScale(palette, spec.density ? 'fraction' : 'count', false, [null, null]),
      },
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            title: (items: TooltipItem<'bar'>[]) => (items[0] ? binText(items[0].dataIndex) : ''),
            label: (item: TooltipItem<'bar'>) => `${item.dataset.label}: ${formatNumber(item.parsed.y)}`,
          },
        },
      },
    },
  }
  const notes = data.size > 0 && [...data.values()].some((s) => s.downsampled)
    ? ['Some series are downsampled; the histogram counts the points kept.']
    : []
  return {
    config: config as unknown as ChartConfiguration,
    legend,
    table: tableRows(resolution, data, hidden, byGroup),
    notes,
  }
}

// ---- scatter ---------------------------------------------------------------

interface ScatterMeta {
  series: ResolvedSeries
  steps: Array<number | null>
}

/** A scatter point carries its run, so the label plugin needs no other state. */
interface LabelledPoint {
  x: number
  y: number
  run: string
}

/**
 * Draws run names next to scatter points when `labels` is "always". It reads
 * the names from the points, so it stays right when the data is replaced.
 */
function pointLabels(palette: Palette): Plugin<'scatter'> {
  return {
    id: 'mdRenderPointLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      ctx.save()
      ctx.font = `11px ${palette.font}`
      ctx.fillStyle = palette.text
      ctx.textBaseline = 'middle'
      chart.data.datasets.forEach((dataset, i) => {
        if (!chart.isDatasetVisible(i)) return
        const points = dataset.data as unknown as LabelledPoint[]
        chart.getDatasetMeta(i).data.forEach((element, j) => {
          const run = points[j]?.run
          if (run) ctx.fillText(run, element.x + 7, element.y - 7)
        })
      })
      ctx.restore()
    },
  }
}

function buildScatter(input: BuildInput): BuiltChart {
  const { spec, resolution, series: data, runs, palette, hidden, view } = input
  const scatter = spec.scatter!
  const { y } = effectiveAxes(spec, view, input.overrides)
  const configs = new Map(runs.map((r) => [r.name, r.config]))
  const members = groupMembers(resolution)
  const meta: ScatterMeta[] = []
  const legend: LegendEntry[] = []
  const missing: string[] = []
  const base = baseOptions(palette)
  const byStep = scatter.per === 'step'

  for (const g of resolution.groups) {
    const first = members.get(g)![0]
    legend.push({
      id: g,
      label: view.group_by === 'none' ? first.run : g,
      color: seriesColor(first, palette),
      dash: [],
      key: null,
      description: null,
      hidden: hidden.has(g),
    })
  }

  const datasets = resolution.series.map((s) => {
    const color = seriesColor(s, palette)
    const points = scatterPoints(s.run, configs.get(s.run) ?? {}, scatter.x, scatter.y, scatter.per, data, spec.summary, spec.better)
    if (points.length === 0) missing.push(s.run)
    meta.push({ series: s, steps: points.map((p) => p.step) })
    return {
      label: view.group_by === 'none' ? s.run : `${s.group}: ${s.run}`,
      // Per-run points carry the run name for the label plugin.
      data: points.map((p) => (byStep ? { x: p.x, y: p.y } : { x: p.x, y: p.y, run: p.run })),
      borderColor: byStep ? withAlpha(color, 0.35) : color,
      backgroundColor: color,
      pointRadius: byStep ? 2 : 4,
      pointHoverRadius: byStep ? 3.5 : 5.5,
      showLine: byStep,
      borderWidth: byStep ? 1 : 0,
      hidden: hidden.has(s.group),
    }
  })

  const notes = missing.length
    ? [`No value for ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}.`]
    : []
  const config: ChartConfiguration<'scatter'> = {
    type: 'scatter',
    data: { datasets },
    plugins: scatter.labels === 'always' && !byStep ? [pointLabels(palette)] : [],
    options: {
      ...base,
      // Room for run names beside points at the edges.
      layout: { padding: scatter.labels === 'always' ? { top: 12, right: 56 } : 0 },
      parsing: false,
      scales: {
        x: {
          ...linearScale(palette, spec.x.label ?? scatter.x.replace(/^config:/, ''), scatter.log_x, spec.x.range),
          ticks: {
            ...linearScale(palette, null, scatter.log_x, spec.x.range).ticks,
            maxTicksLimit: scatter.log_x ? undefined : 8,
            callback: numberTicks(scatter.log_x),
          },
        },
        y: {
          ...linearScale(palette, y.label ?? scatter.y, y.scale === 'log', y.range),
          ticks: { ...linearScale(palette, null, y.scale === 'log', y.range).ticks, callback: numberTicks(y.scale === 'log') },
        },
      },
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            title: (items: TooltipItem<'scatter'>[]) => (items[0] ? meta[items[0].datasetIndex]?.series.run ?? '' : ''),
            label: (item: TooltipItem<'scatter'>) => {
              const step = meta[item.datasetIndex]?.steps[item.dataIndex]
              const lines = [
                `${scatter.x.replace(/^config:/, '')} = ${formatNumber(item.parsed.x)}`,
                `${scatter.y} = ${formatNumber(item.parsed.y)}`,
              ]
              if (step !== null && step !== undefined) lines.push(`step ${formatNumber(step)}`)
              return lines
            },
            afterLabel: (item: TooltipItem<'scatter'>) => meta[item.datasetIndex]?.series.metadata ?? '',
          },
        },
      },
    },
  }
  return {
    config: config as unknown as ChartConfiguration,
    legend,
    table: tableRows(resolution, data, hidden, byGroup),
    notes,
  }
}

/** What to fetch for a view: run names, keys and points per series. */
export function plannedRequest(spec: PlotSpec, resolution: Resolution): { runs: string[]; keys: string[]; maxPoints: number } {
  const runs = resolution.runs
  let keys = resolution.keys
  let maxPoints = spec.max_points
  switch (spec.plot_type) {
    case 'bar':
    case 'spider':
      maxPoints = 0
      break
    case 'histogram':
      maxPoints = Math.min(Math.max(spec.max_points, 1) * 4, 20_000)
      break
    case 'scatter': {
      const scatter = spec.scatter!
      keys = scatter.x.startsWith('config:') ? [scatter.y] : [scatter.x, scatter.y]
      maxPoints = scatter.per === 'step' ? Math.min(Math.max(spec.max_points, 1) * 4, 20_000) : 0
      break
    }
    default:
      break
  }
  return { runs, keys, maxPoints }
}
