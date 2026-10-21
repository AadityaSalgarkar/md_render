import { describe, expect, it } from 'vitest'
import type { TooltipItem } from 'chart.js'
import { bandKeysOf, extremeKeys, foldedKeys } from '../../lib/plots/bands'
import { buildChart, plannedRequest } from '../../lib/plots/chartConfig'
import { withAlpha, type Palette } from '../../lib/plots/palette'
import { deriveViews, resolveView, type View } from '../../lib/plots/views'
import { ema, seriesIndex } from '../../lib/plots/series'
import type { PlotSpec } from '../../lib/plots/schema'
import type { RunInfo, Series } from '../../lib/plots/types'
import { run, series, spec } from './fixtures'

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

const REWARD = ['train/reward/mean', 'train/reward/std', 'train/reward/min', 'train/reward/max']
const KEYS = [...REWARD, 'train/loss', 'val/reward/mean', 'val/reward/std']
const SOLO: RunInfo[] = [run('rl_1', KEYS)]
const MANY: RunInfo[] = [run('rl_1', KEYS), run('rl_2', KEYS)]

function rewards(name: string, shift = 0): Series[] {
  return [
    series(name, 'train/reward/mean', [1 + shift, 2 + shift, 3 + shift]),
    series(name, 'train/reward/std', [0.5, 0.25, 0.1]),
    series(name, 'train/reward/min', [0, 1, 2]),
    series(name, 'train/reward/max', [2, 3, 4]),
    series(name, 'train/loss', [5, 4, 3]),
    series(name, 'val/reward/mean', [1, 1.5, 2]),
    series(name, 'val/reward/std', [0.3, 0.3, 0.3]),
  ]
}
const DATA = seriesIndex([...rewards('rl_1'), ...rewards('rl_2', 1)])

const only = (metrics: string | string[]): View => ({ name: 'test', origin: 'custom', metrics, group_by: 'run' })

function build(s: PlotSpec, view: View, runs: RunInfo[], data = DATA, hidden = new Set<string>()) {
  const resolution = resolveView(view, s, runs)
  return { resolution, built: buildChart({ spec: s, view, resolution, series: data, runs, palette: PALETTE, hidden }) }
}

type Dataset = {
  label: string
  data: Array<{ x: number; y: number | null }>
  fill?: number | boolean
  backgroundColor?: string
  borderColor?: string
  borderDash?: number[]
  borderWidth?: number
  hidden?: boolean
}
const datasetsOf = (built: ReturnType<typeof buildChart>) => built.config.data.datasets as unknown as Dataset[]
const ys = (d: Dataset) => d.data.map((p) => p.y)

describe('statistic groups', () => {
  const logged = new Set(KEYS)

  it('finds the std, min and max beside a mean', () => {
    expect(bandKeysOf('train/reward/mean', logged)).toEqual({
      std: 'train/reward/std',
      min: 'train/reward/min',
      max: 'train/reward/max',
    })
    expect(bandKeysOf('val/reward/mean', logged)).toEqual({ std: 'val/reward/std' })
    expect(bandKeysOf('train/reward/avg', new Set(['train/reward/avg', 'train/reward/stddev']))).toEqual({
      std: 'train/reward/stddev',
    })
  })

  it('needs a mean leaf, a "/" and at least one partner', () => {
    expect(bandKeysOf('train/loss', logged)).toBeNull()
    expect(bandKeysOf('train/reward/std', logged)).toBeNull()
    expect(bandKeysOf('mean', new Set(['mean', 'std']))).toBeNull()
    expect(bandKeysOf('eval/score/mean', new Set(['eval/score/mean']))).toBeNull()
    // Underscores are not a group: reward_mean and reward_std stay two lines.
    expect(bandKeysOf('reward_mean', new Set(['reward_mean', 'reward_std']))).toBeNull()
  })

  it('folds partners only when their mean is shown too', () => {
    expect([...foldedKeys(REWARD, logged)].sort()).toEqual(['train/reward/max', 'train/reward/min', 'train/reward/std'])
    expect(foldedKeys(['train/reward/std', 'train/reward/min'], logged).size).toBe(0)
  })

  it('names the min and max keys that get no chart of their own', () => {
    expect([...extremeKeys(KEYS)].sort()).toEqual(['train/reward/max', 'train/reward/min'])
  })
})

describe('resolving a view with statistic groups', () => {
  const line = spec({ plot_type: 'line' })

  it('draws one banded series for a single run', () => {
    const { series: resolved, keys } = resolveView(only(REWARD), line, SOLO)
    expect(resolved.map((s) => s.key)).toEqual(['train/reward/mean'])
    expect(resolved[0].band).toEqual({ std: 'train/reward/std', min: 'train/reward/min', max: 'train/reward/max' })
    expect(keys).toEqual(['train/reward/mean'])
  })

  it('draws only the means, unbanded, for several runs', () => {
    const resolved = resolveView(only(REWARD), line, MANY).series
    expect(resolved.map((s) => [s.run, s.key, s.band])).toEqual([
      ['rl_1', 'train/reward/mean', null],
      ['rl_2', 'train/reward/mean', null],
    ])
  })

  it('keeps std, min and max as lines when the mean is not in the view', () => {
    const resolved = resolveView(only(['train/reward/std', 'train/reward/max']), line, SOLO).series
    expect(resolved.map((s) => [s.key, s.band])).toEqual([
      ['train/reward/std', null],
      ['train/reward/max', null],
    ])
  })

  it("draws only the partners the block's metrics admit", () => {
    const meanStd = spec({ plot_type: 'line', metrics: '^(train|val)/reward/(mean|std)$' })
    const resolved = resolveView(only(['train/reward/mean']), meanStd, SOLO).series
    expect(resolved[0].band).toEqual({ std: 'train/reward/std' })
    const meanOnly = spec({ plot_type: 'line', metrics: ['train/reward/mean'] })
    expect(resolveView(only(['train/reward/mean']), meanOnly, SOLO).series[0].band).toBeNull()
  })

  it('draws every key as its own line with "bands": false, and in other plot types', () => {
    const plain = resolveView(only(REWARD), spec({ plot_type: 'line', bands: false }), SOLO).series
    expect(plain.map((s) => s.key)).toEqual(REWARD)
    expect(plain.every((s) => s.band === null)).toBe(true)
    const bars = resolveView(only(REWARD), spec({ plot_type: 'bar' }), SOLO).series
    expect(bars).toHaveLength(4)
  })

  it('bands an item that names a mean, when the items cover one run', () => {
    const s = spec({ plot_type: 'line', items: [{ run: 'rl_1', metric: 'train/reward/mean', legend_name: 'reward' }] })
    const view = deriveViews(s, SOLO)[0]
    expect(resolveView(view, s, SOLO).series[0].band?.std).toBe('train/reward/std')
    const two = spec({
      plot_type: 'line',
      items: [
        { run: 'rl_1', metric: 'train/reward/mean' },
        { run: 'rl_2', metric: 'train/reward/mean' },
      ],
    })
    expect(resolveView(deriveViews(two, MANY)[0], two, MANY).series.every((x) => x.band === null)).toBe(true)
  })

  it('fetches the partners of a banded mean, and nothing extra otherwise', () => {
    expect(plannedRequest(line, resolveView(only(['train/reward/mean']), line, SOLO)).keys).toEqual(REWARD)
    expect(plannedRequest(line, resolveView(only(['train/reward/mean']), line, MANY)).keys).toEqual([
      'train/reward/mean',
    ])
  })
})

describe('derived views with statistic groups', () => {
  const names = (runs: RunInfo[]) => deriveViews(spec({ plot_type: 'line' }), runs).map((v) => v.name)

  it('keeps a chart for std but none for min or max', () => {
    const views = names(SOLO)
    expect(views).toContain('train/reward/std')
    expect(views).toContain('train/reward/mean')
    expect(views).not.toContain('train/reward/min')
    expect(views).not.toContain('train/reward/max')
    expect(views).toContain('train/reward components')
    expect(names(MANY)).not.toContain('train/reward/min across runs')
  })

  it('still lists min and max with "bands": false', () => {
    const views = deriveViews(spec({ plot_type: 'line', bands: false }), SOLO).map((v) => v.name)
    expect(views).toContain('train/reward/min')
  })

  it('folds the components view into one banded series', () => {
    const s = spec({ plot_type: 'line' })
    const view = deriveViews(s, SOLO).find((v) => v.name === 'train/reward components')!
    expect(resolveView(view, s, SOLO).series.map((x) => x.key)).toEqual(['train/reward/mean'])
  })
})

describe('drawing a band', () => {
  const line = spec({ plot_type: 'line' })

  it('fills mean ± std faintly and dashes min and max, all in the series colour', () => {
    const { built } = build(line, only(REWARD), SOLO)
    const sets = datasetsOf(built)
    expect(sets.map((d) => d.label)).toEqual([
      'train/reward/mean',
      'train/reward/mean − std',
      'train/reward/mean + std',
      'train/reward/mean min',
      'train/reward/mean max',
    ])
    const [mean, lower, upper, min, max] = sets
    const color = mean.borderColor!
    expect(ys(mean)).toEqual([1, 2, 3])
    expect(ys(lower)).toEqual([0.5, 1.75, 2.9])
    expect(ys(upper)).toEqual([1.5, 2.25, 3.1])
    expect(lower.borderWidth).toBe(0)
    expect(upper.fill).toBe(1)
    expect(upper.backgroundColor).toBe(withAlpha(color, 0.15))
    expect(ys(min)).toEqual([0, 1, 2])
    expect(ys(max)).toEqual([2, 3, 4])
    for (const extreme of [min, max]) {
      expect(extreme.borderDash).toEqual([4, 3])
      expect(extreme.borderColor).toBe(withAlpha(color, 0.45))
    }
    // One legend entry and one table row for the whole group.
    expect(built.legend.map((e) => e.label)).toEqual(['train/reward/mean'])
    expect(built.table.map((r) => r.key)).toEqual(['train/reward/mean'])
  })

  it('hides the band with its series', () => {
    const { resolution } = build(line, only(REWARD), SOLO)
    const { built } = build(line, only(REWARD), SOLO, DATA, new Set([resolution.series[0].id]))
    expect(datasetsOf(built).every((d) => d.hidden)).toBe(true)
  })

  it('reads the spread into the tooltip and keeps band datasets out of it', () => {
    const { built } = build(line, only(REWARD), SOLO)
    const tooltip = (built.config.options as unknown as {
      plugins: { tooltip: { filter: (i: unknown) => boolean; callbacks: { label: (i: unknown) => string } } }
    }).plugins.tooltip
    const item = (datasetIndex: number, dataIndex: number) =>
      ({ datasetIndex, dataIndex, parsed: { x: dataIndex, y: [1, 2, 3][dataIndex] } }) as unknown as TooltipItem<'line'>
    expect(tooltip.callbacks.label(item(0, 1))).toBe('train/reward/mean: 2 ± 0.25 (min 1, max 3)')
    expect([0, 1, 2, 3, 4].map((i) => tooltip.filter(item(i, 0)))).toEqual([true, false, false, false, false])
  })

  it('smooths the partners with the mean', () => {
    const smooth = spec({ plot_type: 'line', y: { smoothing: 0.5 } })
    const sets = datasetsOf(build(smooth, only(REWARD), SOLO).built)
    // The smoothed line is the last dataset with its label; a faint raw one comes first.
    const named = (label: string) => ys(sets.filter((d) => d.label === label).pop()!) as number[]
    const mean = named('train/reward/mean')
    expect(mean).toEqual(ema([1, 2, 3], 0.5))
    const std = ema([0.5, 0.25, 0.1], 0.5)
    expect(named('train/reward/mean + std').map((v, i) => v - mean[i])).toEqual(std.map((v) => expect.closeTo(v, 10)))
    expect(named('train/reward/mean max')).toEqual(ema([2, 3, 4], 0.5))
  })

  it('draws the band only where both the mean and the std were logged', () => {
    const sparse = seriesIndex([
      series('rl_1', 'train/reward/mean', [1, 2, 3]),
      { ...series('rl_1', 'train/reward/std', [0.5, 0.1]), points: [[0, 0.5, 1_000_000], [2, 0.1, 1_002_000]] },
    ])
    const solo = [run('rl_1', ['train/reward/mean', 'train/reward/std'])]
    const sets = datasetsOf(build(line, only(['train/reward/mean', 'train/reward/std']), solo, sparse).built)
    expect(ys(sets[1])).toEqual([0.5, null, 2.9])
  })

  it('leaves out band edges at or below zero on a log scale, and says so', () => {
    const logSpec = spec({ plot_type: 'line', y: { scale: 'log' } })
    const { built } = build(logSpec, only(REWARD), SOLO)
    const sets = datasetsOf(built)
    expect(ys(sets[3])).toEqual([null, 1, 2])
    expect(built.notes.join(' ')).toMatch(/1 values at or below zero/)
  })

  it('draws plain means for several runs', () => {
    const sets = datasetsOf(build(line, only(REWARD), MANY).built)
    expect(sets.map((d) => d.label)).toEqual(['rl_1', 'rl_2'])
  })
})
