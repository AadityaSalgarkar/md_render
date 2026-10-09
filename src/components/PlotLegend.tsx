import type { LegendEntry } from '../lib/plots/chartConfig'
import { MetricHint } from './MetricHint'

interface PlotLegendProps {
  entries: LegendEntry[]
  onToggle: (id: string) => void
  position: 'bottom' | 'right'
}

/** A swatch drawn with the series' colour and dash, as an inline SVG line. */
function Swatch({ color, dash }: { color: string; dash: number[] }) {
  return (
    <svg className="plot-legend-swatch" width="22" height="10" aria-hidden="true">
      <line
        x1="1"
        y1="5"
        x2="21"
        y2="5"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={dash.length ? dash.join(' ') : undefined}
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * The legend as HTML: each entry toggles its series, and an entry whose
 * metric has a description shows it on hover or focus.
 */
export function PlotLegend({ entries, onToggle, position }: PlotLegendProps) {
  return (
    <ul className={`plot-legend plot-legend--${position}`} aria-label="Legend">
      {entries.map((entry) => (
        <li key={entry.id}>
          <MetricHint metric={entry.key ?? ''} description={entry.key ? entry.description : null}>
            <button
              type="button"
              className={`plot-legend-entry${entry.hidden ? ' is-hidden' : ''}`}
              aria-pressed={!entry.hidden}
              onClick={() => onToggle(entry.id)}
            >
              <Swatch color={entry.color} dash={entry.dash} />
              <span className="plot-legend-label">{entry.label}</span>
            </button>
          </MetricHint>
        </li>
      ))}
    </ul>
  )
}
