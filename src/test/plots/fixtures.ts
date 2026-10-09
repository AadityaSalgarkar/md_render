import type { RunInfo, Series } from '../../lib/plots/types'
import { parsePlotBlock, type PlotSpec } from '../../lib/plots/schema'

/** A run as the backend lists it. */
export function run(name: string, keys: string[], config: Record<string, string | number | boolean | null> = {}): RunInfo {
  return {
    name,
    ids: [`id-${name}`],
    ambiguous: false,
    created_at: null,
    first_step: 0,
    last_step: 9,
    rows: 10,
    first_ms: 1_000_000,
    last_ms: 1_009_000,
    keys: keys.map((key) => ({ key, count: 10 })),
    config,
  }
}

export const KEYS = [
  'train/loss/ce',
  'train/loss/kl_teacher_student',
  'val/loss/ce',
  'val/acc/top1',
  '__step',
]

/** Three runs with consistent split/family/name keys and a config each. */
export const RUNS: RunInfo[] = [
  run('exp_1', KEYS, { 'model.arch': 'conv', lr: 0.001, seed: 1 }),
  run('exp_2', KEYS, { 'model.arch': 'vit', lr: 0.001, seed: 2 }),
  run('exp_3', KEYS, { 'model.arch': 'conv', lr: 0.0003, seed: 3 }),
]

export function spec(json: Record<string, unknown>): PlotSpec {
  const result = parsePlotBlock(JSON.stringify({ source: { project: 'demo' }, ...json }))
  if (!result.ok) throw new Error(result.error)
  return result.spec
}

/** A series with values `values` at steps 0..n-1, one second apart. */
export function series(runName: string, key: string, values: number[]): Series {
  const points = values.map((v, i) => [i, v, 1_000_000 + i * 1000] as [number, number, number])
  return {
    run: runName,
    key,
    n: values.length,
    n_nonfinite: 0,
    downsampled: false,
    summary: values.length
      ? {
          first: values[0],
          last: values[values.length - 1],
          min: Math.min(...values),
          max: Math.max(...values),
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          argmin_step: values.indexOf(Math.min(...values)),
          argmax_step: values.indexOf(Math.max(...values)),
        }
      : null,
    points,
  }
}
