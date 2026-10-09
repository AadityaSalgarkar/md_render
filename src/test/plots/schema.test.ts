import { describe, expect, it } from 'vitest'
import { parsePlotBlock, type PlotSpec } from '../../lib/plots/schema'

function parsed(json: unknown): PlotSpec {
  const result = parsePlotBlock(JSON.stringify(json))
  if (!result.ok) throw new Error(result.error)
  return result.spec
}

function error(json: unknown): string {
  const result = parsePlotBlock(typeof json === 'string' ? json : JSON.stringify(json))
  if (result.ok) throw new Error('expected an error')
  return result.error
}

describe('plot block schema', () => {
  it('fills every default', () => {
    const spec = parsed({ plot_type: 'line', source: { project: 'demo' } })
    expect(spec).toMatchObject({
      plot_type: 'line',
      source: { project: 'demo' },
      runs: '.*',
      metrics: '.*',
      items: [],
      views: [],
      default_view: null,
      x: { axis: 'step', range: [null, null], label: null },
      y: { scale: 'linear', smoothing: 0, show_raw: true },
      dedupe_steps: 'last',
      summary: 'last',
      better: 'auto',
      bins: 30,
      max_points: 1500,
      refresh: 'auto',
      height: 320,
      legend: 'auto',
      id: null,
      scatter: null,
    })
  })

  it('accepts the aliases authors reach for', () => {
    expect(parsed({ plot_type: 'line-graph', source: { db: 'a.db' } }).plot_type).toBe('line')
    expect(parsed({ plot_type: 'radar', source: { db: 'a.db' } }).plot_type).toBe('spider')
    expect(parsed({ type: 'hist', source: { db: 'a.db' } }).plot_type).toBe('histogram')
  })

  it('keeps items, views and descriptions', () => {
    const spec = parsed({
      plot_type: 'line',
      source: { project: 'distill' },
      descriptions: { '*/loss/ce': 'Cross entropy.' },
      items: [
        { run: 'exp_1', metric: 'val/loss/ce', legend_name: 'exp 1', metadata: 'lr=3e-4', style: { color: '#123456', dash: 'dashed', width: 2 } },
      ],
      views: [{ name: 'by arch', metrics: '^val/', group_by: 'config:model.arch', y: { scale: 'log' } }],
      default_view: 'by arch',
      refresh: 10,
    })
    expect(spec.items[0]).toEqual({
      run: 'exp_1',
      metric: 'val/loss/ce',
      legend_name: 'exp 1',
      metadata: 'lr=3e-4',
      style: { color: '#123456', dash: 'dashed', width: 2 },
    })
    expect(spec.views[0]).toEqual({ name: 'by arch', metrics: '^val/', group_by: 'config:model.arch', y: { scale: 'log' } })
    expect(spec.descriptions).toEqual({ '*/loss/ce': 'Cross entropy.' })
    expect(spec.refresh).toBe(10)
  })

  it('needs scatter axes for a scatter plot', () => {
    expect(error({ plot_type: 'scatter', source: { project: 'p' } })).toMatch(/scatter/)
    const spec = parsed({ plot_type: 'scatter', source: { project: 'p' }, scatter: { x: 'config:n', y: 'val/acc' } })
    expect(spec.scatter).toEqual({ x: 'config:n', y: 'val/acc', per: 'run', log_x: false, labels: 'hover' })
  })

  it('explains what is wrong', () => {
    expect(error('{ not json')).toMatch(/not valid JSON/)
    expect(error({ source: { project: 'p' } })).toMatch(/plot_type/)
    expect(error({ plot_type: 'pie', source: { project: 'p' } })).toMatch(/"pie"/)
    expect(error({ plot_type: 'line' })).toMatch(/source/)
    expect(error({ plot_type: 'line', source: { project: 'p', db: 'x.db' } })).toMatch(/exactly one/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, runs: '(' })).toMatch(/"runs"/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, runs: 'a'.repeat(201) })).toMatch(/longer than 200/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, items: [{ run: 'a' }] })).toMatch(/metric/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, items: [{ metric: 'a' }] })).toMatch(/run/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, views: [{ name: 'a', group_by: 'colour' }] })).toMatch(/group_by/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, views: [{ name: 'a' }, { name: 'a' }] })).toMatch(/two views/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, y: { smoothing: 1.5 } })).toMatch(/smoothing/)
    expect(error({ plot_type: 'line', source: { project: 'p' }, refresh: 1 })).toMatch(/refresh/)
  })

  it('warns about unknown fields instead of failing', () => {
    const result = parsePlotBlock(JSON.stringify({ plot_type: 'bar', source: { project: 'p' }, colour: 'red' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual(['unknown field "colour" ignored'])
  })
})
