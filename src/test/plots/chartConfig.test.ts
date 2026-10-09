import { afterEach, describe, expect, it } from 'vitest'
import type { ChartDataset, TooltipItem } from 'chart.js'
import { buildChart, numberTicks, plannedRequest, type BuildInput } from '../../lib/plots/chartConfig'
import { parseColor, readPalette, shade, type Palette } from '../../lib/plots/palette'
import { deriveViews, resolveView, type View } from '../../lib/plots/views'
import { describer } from '../../lib/plots/descriptions'
import { seriesIndex } from '../../lib/plots/series'
import type { PlotSpec } from '../../lib/plots/schema'
import { RUNS, series, spec } from './fixtures'

const PALETTE: Palette = {
  series: ['#ff0000', '#00ff00', '#0000ff', '#888800', '#880088', '#008888', '#444444', '#999999'],
  text: '#333333',
  muted: '#777777',
  grid: '#dddddd',
  surface: '#fafafa',
  font: 'Georgia',
  mono: 'monospace',
  mode: 'light',
}

const DATA = seriesIndex(
  RUNS.flatMap((r, i) => [
    series(r.name, 'train/loss/ce', [3 - i, 2 - i * 0.5, 1]),
    series(r.name, 'val/loss/ce', [3.5, 2.5, 1.5 + i]),
    series(r.name, 'val/acc/top1', [0.1, 0.5, 0.6 + i * 0.1]),
    series(r.name, 'train/loss/kl_teacher_student', [0.3, 0.2, 0.1]),
  ]),
)

function build(s: PlotSpec, view: View, extra: Partial<BuildInput> = {}) {
  const describe_ = describer(s.descriptions)
  return buildChart({
    spec: s,
    view,
    resolution: resolveView(view, s, RUNS, describe_),
    series: DATA,
    runs: RUNS,
    palette: PALETTE,
    hidden: new Set(),
    ...extra,
  })
}

function viewNamed(s: PlotSpec, name: string): View {
  const view = deriveViews(s, RUNS).find((v) => v.name === name)
  if (!view) throw new Error(`no view ${name}`)
  return view
}

type Callbacks = Record<string, (arg: unknown) => unknown>
function tooltipCallbacks(config: unknown): Callbacks {
  return (config as { options: { plugins: { tooltip: { callbacks: Callbacks } } } }).options.plugins.tooltip
    .callbacks
}

describe('palette', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.mode
  })

  it('reads chart colours from the theme variables', () => {
    const root = document.documentElement
    root.style.setProperty('--chart-1', '#112233')
    root.style.setProperty('--text-secondary', '#445566')
    root.dataset.mode = 'dark'
    const palette = readPalette(root)
    expect(palette.series[0]).toBe('#112233')
    expect(palette.series[1]).toBe('#2D5A4A')
    expect(palette.text).toBe('#445566')
    expect(palette.mode).toBe('dark')
  })

  it('spreads shades of one hue by lightness', () => {
    expect(shade('#C9553D', 0, 1)).toBe('#C9553D')
    const lightness = [0, 1, 2].map((i) => Number(/ (\d+)%\)$/.exec(shade('#C9553D', i, 3))![1]))
    expect(lightness[0]).toBeLessThan(lightness[1])
    expect(lightness[1]).toBeLessThan(lightness[2])
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1])
    expect(parseColor('#abc')).toEqual([170, 187, 204, 1])
  })
})

describe('line config', () => {
  const s = spec({ plot_type: 'line', descriptions: { '*/loss/ce': 'Cross entropy.' } })

  it('colours by run and dashes by split, with a legend entry per series', () => {
    const built = build(s, viewNamed(s, 'loss/ce: train vs val'))
    const datasets = built.config.data.datasets as ChartDataset<'line'>[]
    expect(datasets).toHaveLength(6)
    expect(datasets[0].borderColor).toBe('#ff0000')
    expect(datasets[1].borderColor).toBe('#ff0000')
    expect(datasets[0].borderDash).toEqual([])
    expect(datasets[1].borderDash).toEqual([6, 4])
    expect(datasets[2].borderColor).toBe('#00ff00')
    expect(built.legend.map((e) => e.label)).toEqual([
      'exp_1 · train/loss/ce',
      'exp_1 · val/loss/ce',
      'exp_2 · train/loss/ce',
      'exp_2 · val/loss/ce',
      'exp_3 · train/loss/ce',
      'exp_3 · val/loss/ce',
    ])
    expect(built.legend[0].description).toBe('Cross entropy.')
    expect(built.config.options?.animation).toBe(false)
    expect(built.table.map((r) => r.last)).toEqual([1, 1.5, 1, 2.5, 1, 3.5])
  })

  it('draws smoothed and faint raw lines, and the tooltip skips the raw ones', () => {
    const built = build({ ...s, y: { ...s.y, smoothing: 0.6 } }, viewNamed(s, 'val/loss/ce across runs'))
    const datasets = built.config.data.datasets as ChartDataset<'line'>[]
    expect(datasets).toHaveLength(6)
    expect(String(datasets[0].borderColor)).toMatch(/^rgba\(255, 0, 0, 0.25\)$/)
    expect(datasets[1].borderColor).toBe('#ff0000')
    const tooltip = (built.config.options as { plugins: { tooltip: { filter: (i: unknown) => boolean } } }).plugins.tooltip
    expect(tooltip.filter({ datasetIndex: 0 })).toBe(false)
    expect(tooltip.filter({ datasetIndex: 1 })).toBe(true)
  })

  it('hides series the legend turned off, and drops them from the table', () => {
    const view = viewNamed(s, 'val/loss/ce across runs')
    const id = resolveView(view, s, RUNS).series[1].id
    const built = build(s, view, { hidden: new Set([id]) })
    expect((built.config.data.datasets as ChartDataset<'line'>[]).map((d) => d.hidden)).toEqual([false, true, false])
    expect(built.legend[1].hidden).toBe(true)
    expect(built.table.map((r) => r.run)).toEqual(['exp_1', 'exp_3'])
  })

  it('switches the x axis to elapsed seconds and the y axis to log', () => {
    const built = build(s, viewNamed(s, 'val/loss/ce across runs'), { overrides: { axis: 'relative', scale: 'log' } })
    const first = (built.config.data.datasets as ChartDataset<'line'>[])[0].data as Array<{ x: number }>
    expect(first.map((p) => p.x)).toEqual([0, 1, 2])
    expect((built.config.options as { scales: { y: { type: string } } }).scales.y.type).toBe('logarithmic')
  })

  it('shows metadata and the shared description in the tooltip', () => {
    const items = spec({
      plot_type: 'line',
      descriptions: { 'val/**': 'Held out.' },
      items: [{ run: 'exp_1', metric: 'val/loss/ce', legend_name: 'baseline', metadata: 'lr=1e-3' }],
    })
    const built = build(items, viewNamed(items, 'Series'))
    const callbacks = tooltipCallbacks(built.config)
    const item = { datasetIndex: 0, dataIndex: 1, parsed: { x: 1, y: 2.5 } } as unknown as TooltipItem<'line'>
    expect(callbacks.label(item)).toBe('baseline: 2.5')
    expect(callbacks.afterLabel(item)).toBe('lr=1e-3')
    expect(callbacks.footer([item])).toBe('Held out.')
    expect(callbacks.title([item])).toBe('step 1')
  })
})

describe('summary plots', () => {
  it('bar: one bar per run for one key, coloured per run, values from the summary', () => {
    const s = spec({ plot_type: 'bar', summary: 'best' })
    const built = build(s, viewNamed(s, 'val/acc/top1 across runs'))
    expect(built.config.data.labels).toEqual(['exp_1', 'exp_2', 'exp_3'])
    const [dataset] = built.config.data.datasets as ChartDataset<'bar'>[]
    expect(dataset.data).toEqual([0.6, 0.7, 0.8])
    expect(built.legend.map((e) => e.id)).toEqual(['exp_1', 'exp_2', 'exp_3'])
    const hidden = build(s, viewNamed(s, 'val/acc/top1 across runs'), { hidden: new Set(['exp_2']) })
    expect(hidden.config.data.labels).toEqual(['exp_1', 'exp_3'])
  })

  it('bar: averages a config group and lists its members', () => {
    const s = spec({ plot_type: 'bar' })
    const built = build(s, viewNamed(s, 'val/loss/ce by model.arch'))
    expect(built.config.data.labels).toEqual(['conv', 'vit'])
    const [dataset] = built.config.data.datasets as ChartDataset<'bar'>[]
    expect(dataset.data).toEqual([(1.5 + 3.5) / 2, 2.5])
    const callbacks = tooltipCallbacks(built.config)
    expect(callbacks.afterLabel({ datasetIndex: 0, dataIndex: 0 })).toEqual(['mean of exp_1, exp_3'])
  })

  it('bar: one dataset per key when a view has several', () => {
    const s = spec({ plot_type: 'bar' })
    const built = build(s, viewNamed(s, 'train/loss components'))
    expect((built.config.data.datasets as ChartDataset<'bar'>[]).map((d) => d.label)).toEqual([
      'train/loss/ce',
      'train/loss/kl_teacher_student',
    ])
  })

  it('spider: one polygon per run over the keys, normalised when scales differ', () => {
    const s = spec({ plot_type: 'spider', metrics: ['val/loss/ce', 'val/acc/top1'], normalize: 'minmax' })
    const built = build(s, viewNamed(s, 'all metrics'))
    expect(built.config.data.labels).toEqual(['val/loss/ce', 'val/acc/top1'])
    const datasets = built.config.data.datasets as ChartDataset<'radar'>[]
    const expected = [[0, 0], [0.5, 0.5], [1, 1]]
    datasets.forEach((d, i) => (d.data as number[]).forEach((v, j) => expect(v).toBeCloseTo(expected[i][j], 12)))
    const callbacks = tooltipCallbacks(built.config)
    expect(callbacks.label({ datasetIndex: 2, dataIndex: 0, dataset: { label: 'exp_3' } })).toBe('exp_3: 3.5 (last)')
  })

  it('histogram: one dataset per group over shared bins', () => {
    const s = spec({ plot_type: 'histogram', bins: 4, metrics: ['val/acc/top1'] })
    const built = build(s, viewNamed(s, 'val/acc/top1 by model.arch'))
    const datasets = built.config.data.datasets as ChartDataset<'bar'>[]
    expect(datasets.map((d) => d.label)).toEqual(['conv', 'vit'])
    expect(datasets.map((d) => (d.data as number[]).reduce((a, b) => a + b, 0))).toEqual([6, 3])
    expect(built.config.data.labels).toHaveLength(4)
  })

  it('scatter: a point per run from a config value and a summarised metric', () => {
    const s = spec({ plot_type: 'scatter', summary: 'best', scatter: { x: 'config:lr', y: 'val/acc/top1', labels: 'always' } })
    const built = build(s, viewNamed(s, 'by model.arch'))
    const datasets = built.config.data.datasets as ChartDataset<'scatter'>[]
    expect(datasets.map((d) => d.data)).toEqual([
      [{ x: 0.001, y: 0.6, run: 'exp_1' }],
      [{ x: 0.0003, y: 0.8, run: 'exp_3' }],
      [{ x: 0.001, y: 0.7, run: 'exp_2' }],
    ])
    expect(built.legend.map((e) => e.label)).toEqual(['conv', 'vit'])
    expect(built.config.plugins).toHaveLength(1)
  })
})

describe('tick labels', () => {
  it('keep only 1, 2 and 5 multiples on a log axis', () => {
    const log = numberTicks(true)
    expect([1e6, 2e6, 3e6, 5e6, 0.01, 0.03].map(log)).toEqual(['1M', '2M', '', '5M', '0.01', ''])
    expect(numberTicks(false)(3e6)).toBe('3M')
  })
})

describe('what to fetch', () => {
  it('asks for summaries only where points are not drawn', () => {
    for (const [plot_type, maxPoints] of [['line', 1500], ['bar', 0], ['spider', 0], ['histogram', 6000]] as const) {
      const s = spec({ plot_type })
      const view = deriveViews(s, RUNS)[0]
      expect(plannedRequest(s, resolveView(view, s, RUNS)).maxPoints).toBe(maxPoints)
    }
    const scatter = spec({ plot_type: 'scatter', scatter: { x: 'train/loss/ce', y: 'val/acc/top1', per: 'step' } })
    const planned = plannedRequest(scatter, resolveView(deriveViews(scatter, RUNS)[0], scatter, RUNS))
    expect(planned.keys).toEqual(['train/loss/ce', 'val/acc/top1'])
    expect(planned.maxPoints).toBe(6000)
  })
})
