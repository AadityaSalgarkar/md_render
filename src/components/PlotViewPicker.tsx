import { useState } from 'react'
import { compilePattern } from '../lib/plots/schema'
import type { View } from '../lib/plots/views'

export const CUSTOM_VIEW = '\u0000custom'

interface PlotViewPickerProps {
  views: View[]
  active: View
  /** Config keys that make sensible groupings, for the custom form. */
  configKeys: string[]
  onSelect: (name: string) => void
  onCustom: (view: View) => void
}

const SECTIONS: Array<{ label: string; test: (v: View) => boolean }> = [
  { label: 'This block', test: (v) => v.origin === 'series' || v.origin === 'block' },
  { label: 'From the data', test: (v) => v.origin === 'derived' },
]

function selectorText(selector: View['runs']): string {
  if (selector === undefined) return '.*'
  if (Array.isArray(selector)) return `^(${selector.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
  return selector
}

/** The view dropdown, plus a small form to write a view by hand. */
export function PlotViewPicker({ views, active, configKeys, onSelect, onCustom }: PlotViewPickerProps) {
  const [editing, setEditing] = useState(false)
  const [runs, setRuns] = useState('')
  const [metrics, setMetrics] = useState('')
  const [groupBy, setGroupBy] = useState('run')
  const [legend, setLegend] = useState('')
  const [error, setError] = useState<string | null>(null)

  const openForm = () => {
    setRuns(selectorText(active.runs))
    setMetrics(selectorText(active.metrics))
    setGroupBy(active.group_by)
    setLegend(active.legend ?? '')
    setError(null)
    setEditing(true)
  }

  const apply = () => {
    try {
      compilePattern(runs || '.*', 'runs')
      compilePattern(metrics || '.*', 'metrics')
      if (groupBy.startsWith('run:')) compilePattern(groupBy.slice(4), 'group by')
    } catch (err) {
      setError((err as Error).message)
      return
    }
    onCustom({
      name: 'Custom',
      origin: 'custom',
      runs: runs || '.*',
      metrics: metrics || '.*',
      group_by: groupBy,
      legend: legend || undefined,
    })
    setEditing(false)
  }

  const groupOptions = ['run', 'metric', 'none', ...configKeys.map((k) => `config:${k}`)]
  if (!groupOptions.includes(groupBy)) groupOptions.push(groupBy)
  const value = active.origin === 'custom' ? CUSTOM_VIEW : active.name

  return (
    <div className="plot-view-picker">
      <label className="plot-control">
        <span className="plot-control-label">View</span>
        <select
          value={value}
          onChange={(event) => {
            if (event.target.value === CUSTOM_VIEW) openForm()
            else {
              setEditing(false)
              onSelect(event.target.value)
            }
          }}
        >
          {SECTIONS.map((section) => {
            const members = views.filter(section.test)
            if (members.length === 0) return null
            return (
              <optgroup key={section.label} label={section.label}>
                {members.map((view) => (
                  <option key={view.name} value={view.name}>
                    {view.name}
                  </option>
                ))}
              </optgroup>
            )
          })}
          <option value={CUSTOM_VIEW}>Custom…</option>
        </select>
      </label>
      {editing && (
        <form
          className="plot-custom-form"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <label>
            <span>Runs</span>
            <input value={runs} onChange={(e) => setRuns(e.target.value)} placeholder="regex over run names" spellCheck={false} />
          </label>
          <label>
            <span>Metrics</span>
            <input value={metrics} onChange={(e) => setMetrics(e.target.value)} placeholder="regex over metric keys" spellCheck={false} />
          </label>
          <label>
            <span>Group by</span>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {groupOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Legend</span>
            <input value={legend} onChange={(e) => setLegend(e.target.value)} placeholder="{run} · {metric}" spellCheck={false} />
          </label>
          {error && <p className="plot-custom-error" role="alert">{error}</p>}
          <div className="plot-custom-actions">
            <button type="submit">Apply</button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
