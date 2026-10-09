import { describe, expect, it } from 'vitest'
import {
  betterFor,
  ema,
  formatElapsed,
  formatNumber,
  histogram,
  minmaxColumns,
  needsNormalising,
  reduce,
  scatterPoints,
  seriesIndex,
  xOf,
} from '../../lib/plots/series'
import { series } from './fixtures'

describe('series transforms', () => {
  it('smooths like TensorBoard, debiased from the first point', () => {
    expect(ema([1, 2, 3], 0)).toEqual([1, 2, 3])
    const smoothed = ema([1, 1, 1, 1], 0.9)
    smoothed.forEach((v) => expect(v).toBeCloseTo(1, 12))
    const [a, b] = ema([0, 10], 0.5)
    expect(a).toBe(0)
    // last = 0.5*0 + 0.5*10 = 5 after the bias 0.25 -> 5 / 0.75
    expect(b).toBeCloseTo(5 / 0.75, 12)
  })

  it('maps points to step, time or seconds since the first row', () => {
    const point: [number, number, number | null] = [7, 0.5, 5000]
    expect(xOf(point, 'step', null)).toBe(7)
    expect(xOf(point, 'time', null)).toBe(5000)
    expect(xOf(point, 'relative', 2000)).toBe(3)
    expect(xOf([7, 0.5, null], 'time', null)).toBeNull()
  })

  it('knows which way is better', () => {
    expect(betterFor('val/loss/ce')).toBe('min')
    expect(betterFor('val/og2_euk/bpb')).toBe('min')
    expect(betterFor('val/acc/top1')).toBe('max')
    const summary = series('r', 'k', [3, 1, 2]).summary
    expect(reduce(summary, 'best', 'auto', 'train/loss')).toBe(1)
    expect(reduce(summary, 'best', 'auto', 'acc')).toBe(3)
    expect(reduce(summary, 'best', 'max', 'train/loss')).toBe(3)
    expect(reduce(summary, 'last', 'auto', 'x')).toBe(2)
    expect(reduce(null, 'last', 'auto', 'x')).toBeNull()
  })

  it('bins histograms on shared edges', () => {
    const hist = histogram([[0, 0, 1], [1, 2, 2]], 2, false)
    expect(hist.edges).toEqual([0, 1, 2])
    expect(hist.counts).toEqual([[2, 1], [0, 3]])
    const density = histogram([[0, 0, 1, 2]], 2, true)
    expect(density.counts[0].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(histogram([[5, 5]], 4, false).counts[0].reduce((a, b) => a + b, 0)).toBe(2)
    expect(histogram([[]], 4, false).edges).toEqual([])
  })

  it('normalises spider axes when they differ in scale', () => {
    const matrix = [[1, 100], [3, 300], [2, null]]
    expect(needsNormalising(matrix)).toBe(true)
    expect(needsNormalising([[1, 2], [2, 3]])).toBe(false)
    expect(minmaxColumns(matrix)).toEqual([[0, 0], [1, 1], [0.5, null]])
    expect(minmaxColumns([[4], [4]])).toEqual([[0.5], [0.5]])
  })

  it('builds scatter points per run and per step', () => {
    const lookup = seriesIndex([
      series('a', 'val/acc', [0.5, 0.7, 0.6]),
      series('a', 'train/loss', [2, 1, 0.5]),
    ])
    expect(scatterPoints('a', { n: 1000 }, 'config:n', 'val/acc', 'run', lookup, 'best', 'auto')).toEqual([
      { x: 1000, y: 0.7, run: 'a', step: null },
    ])
    expect(scatterPoints('a', {}, 'train/loss', 'val/acc', 'run', lookup, 'last', 'auto')).toEqual([
      { x: 0.5, y: 0.6, run: 'a', step: null },
    ])
    expect(scatterPoints('a', {}, 'train/loss', 'val/acc', 'step', lookup, 'last', 'auto')).toEqual([
      { x: 2, y: 0.5, run: 'a', step: 0 },
      { x: 1, y: 0.7, run: 'a', step: 1 },
      { x: 0.5, y: 0.6, run: 'a', step: 2 },
    ])
    expect(scatterPoints('a', {}, 'config:n', 'val/acc', 'run', lookup, 'last', 'auto')).toEqual([])
    expect(scatterPoints('b', { n: 1 }, 'config:n', 'val/acc', 'run', lookup, 'last', 'auto')).toEqual([])
  })

  it('formats numbers and elapsed time for people', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(0.123456)).toBe('0.1235')
    expect(formatNumber(2.5e-5)).toBe('2.50e-5')
    expect(formatNumber(null)).toBe('–')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(3725)).toBe('1:02:05')
  })
})
