import { describe, expect, it } from 'vitest'
import {
  configCandidates,
  defaultView,
  deriveViews,
  resolveView,
  select,
  type View,
} from '../../lib/plots/views'
import { describer } from '../../lib/plots/descriptions'
import { RUNS, run, spec } from './fixtures'

const names = (views: View[]) => views.map((v) => v.name)

describe('selectors', () => {
  it('regexes keep input order, lists keep their own and only existing names', () => {
    expect(select('^exp_[12]$', ['exp_1', 'exp_2', 'exp_3'])).toEqual(['exp_1', 'exp_2'])
    expect(select(['exp_3', 'missing', 'exp_1'], ['exp_1', 'exp_2', 'exp_3'])).toEqual(['exp_3', 'exp_1'])
  })

  it('hides internal keys from regexes but not from lists', () => {
    expect(select('.*', ['__step', 'a'], true)).toEqual(['a'])
    expect(select(['__step'], ['__step', 'a'], true)).toEqual(['__step'])
  })
})

describe('derived views for a line plot', () => {
  const views = deriveViews(spec({ plot_type: 'line' }), RUNS)

  it('derives train vs val, components, per-key and config views in that order', () => {
    expect(names(views)).toEqual([
      'loss/ce: train vs val',
      'train/loss components',
      'train/loss/ce across runs',
      'train/loss/kl_teacher_student across runs',
      'val/acc/top1 across runs',
      'val/loss/ce across runs',
      'val/acc/top1 by lr',
      'val/loss/ce by lr',
      'val/acc/top1 by model.arch',
      'val/loss/ce by model.arch',
    ])
  })

  it('groups train vs val by run so the split varies by dash', () => {
    const view = views[0]
    expect(view.group_by).toBe('run')
    const resolved = resolveView(view, spec({ plot_type: 'line' }), RUNS)
    expect(resolved.groups).toEqual(['exp_1', 'exp_2', 'exp_3'])
    expect(resolved.series.map((s) => [s.run, s.key, s.dash])).toEqual([
      ['exp_1', 'train/loss/ce', 0],
      ['exp_1', 'val/loss/ce', 1],
      ['exp_2', 'train/loss/ce', 0],
      ['exp_2', 'val/loss/ce', 1],
      ['exp_3', 'train/loss/ce', 0],
      ['exp_3', 'val/loss/ce', 1],
    ])
    expect(resolved.series[0].label).toBe('exp_1 · train/loss/ce')
  })

  it('names views for a single run differently', () => {
    const single = deriveViews(spec({ plot_type: 'line', runs: '^exp_1$' }), RUNS)
    expect(names(single)).toEqual([
      'train vs val: loss/ce',
      'train/loss components',
      'train/loss/ce',
      'train/loss/kl_teacher_student',
      'val/acc/top1',
      'val/loss/ce',
    ])
    expect(single[0].group_by).toBe('metric')
  })

  it('skips the seed, which is unique per run, and keeps lr and arch', () => {
    expect(configCandidates(RUNS)).toEqual(['lr', 'model.arch'])
  })

  it('puts the Series view and block views first, and resolves the default', () => {
    const s = spec({
      plot_type: 'line',
      items: [{ run: 'exp_1', metric: 'val/loss/ce' }],
      views: [{ name: 'mine', metrics: '^val/' }],
    })
    const all = deriveViews(s, RUNS)
    expect(names(all).slice(0, 2)).toEqual(['Series', 'mine'])
    expect(defaultView(s, all)?.name).toBe('Series')
    expect(defaultView({ ...s, default_view: 'val/loss/ce by lr' }, all)?.name).toBe('val/loss/ce by lr')
    const noItems = spec({ plot_type: 'line', views: [{ name: 'mine' }] })
    expect(defaultView(noItems, deriveViews(noItems, RUNS))?.name).toBe('mine')
  })
})

describe('derived views for other plot types', () => {
  it('replaces train vs val with all metrics for bar, spider and histogram', () => {
    for (const plot_type of ['bar', 'spider', 'histogram']) {
      expect(names(deriveViews(spec({ plot_type }), RUNS))[0]).toBe('all metrics')
    }
  })

  it('offers all runs and config groupings for scatter', () => {
    const views = deriveViews(
      spec({ plot_type: 'scatter', scatter: { x: 'config:lr', y: 'val/acc/top1' } }),
      RUNS,
    )
    expect(names(views)).toEqual(['all runs', 'by lr', 'by model.arch'])
  })
})

describe('grouping', () => {
  const s = spec({ plot_type: 'line' })

  it('groups by a config value, with shades within a group', () => {
    const view: View = { name: 'x', origin: 'block', metrics: ['val/loss/ce'], group_by: 'config:model.arch' }
    const resolved = resolveView(view, s, RUNS)
    expect(resolved.groups).toEqual(['conv', 'vit'])
    expect(resolved.series.map((s) => [s.label, s.groupIndex, s.shade, s.shadeCount])).toEqual([
      ['conv: exp_1', 0, 0, 2],
      ['conv: exp_3', 0, 1, 2],
      ['vit: exp_2', 1, 0, 1],
    ])
  })

  it('groups by a capture in the run name, with the rest as (other)', () => {
    const runs = [run('og2_flow_overfit1', ['val/bpb']), run('og2_linear_overfit8', ['val/bpb']), run('baseline', ['val/bpb'])]
    const view: View = { name: 'x', origin: 'block', group_by: 'run:^og2_([a-z]+)_' }
    expect(resolveView(view, s, runs).groups).toEqual(['(other)', 'flow', 'linear'])
  })

  it('fills legend templates', () => {
    const view: View = {
      name: 'x',
      origin: 'block',
      metrics: ['val/loss/ce'],
      group_by: 'metric',
      legend: '{run} ({config:model.arch}, {config:missing})',
    }
    expect(resolveView(view, s, RUNS).series.map((x) => x.label)).toEqual([
      'exp_1 (conv, (unset))',
      'exp_2 (vit, (unset))',
      'exp_3 (conv, (unset))',
    ])
  })

  it('attaches descriptions and says what did not match', () => {
    const describe_ = describer({ '*/loss/ce': 'Cross entropy.' })
    const view: View = { name: 'x', origin: 'block', metrics: ['val/loss/ce'], group_by: 'run' }
    expect(resolveView(view, s, RUNS, describe_).series[0].description).toBe('Cross entropy.')
    expect(resolveView({ ...view, runs: '^nope' }, s, RUNS).empty).toBe('No run matches ^nope.')
    expect(resolveView({ ...view, metrics: '^gone$' }, s, RUNS).empty).toMatch(/No metric matches \^gone\$/)
  })

  it('resolves explicit items with their legend names, metadata and styles', () => {
    const items = spec({
      plot_type: 'bar',
      items: [
        { run: 'exp_1', metric: 'val/acc/top1', legend_name: 'baseline', metadata: 'no aug', style: { color: '#123456' } },
        { run_regex: '^exp_[23]$', metric: 'val/acc/top1', legend_name: 'others' },
        { run: 'missing', metric: 'val/acc/top1' },
      ],
    })
    const [series] = deriveViews(items, RUNS)
    const resolved = resolveView(series, items, RUNS)
    expect(resolved.series.map((x) => [x.label, x.metadata, x.style?.color ?? null])).toEqual([
      ['baseline', 'no aug', '#123456'],
      ['others (exp_2)', null, null],
      ['others (exp_3)', null, null],
    ])
    expect(new Set(resolved.series.map((x) => x.groupIndex)).size).toBe(3)
  })
})
