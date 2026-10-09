import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Chart } from 'chart.js'
import { parsePlotBlock, showsTable, type PlotSpec } from '../lib/plots/schema'
import { configCandidates, defaultView, deriveViews, resolveView, type View } from '../lib/plots/views'
import { describer } from '../lib/plots/descriptions'
import { buildChart, effectiveAxes, plannedRequest, type Overrides } from '../lib/plots/chartConfig'
import { readPalette, type Palette } from '../lib/plots/palette'
import { formatNumber, seriesKey } from '../lib/plots/series'
import { loadChart } from '../lib/plots/chartjs'
import {
  ExperimentsError,
  isUnchanged,
  type RunsResponse,
  type Series,
} from '../lib/plots/types'
import { AUTO_REFRESH_MS, AUTO_REFRESH_WINDOW_MS, PlotContext } from '../lib/plots/context'
import { MetricHint } from './MetricHint'
import { PlotCaption } from './PlotCaption'
import { PlotLegend } from './PlotLegend'
import { PlotViewPicker } from './PlotViewPicker'

/** A fetched series and the points-per-series it was fetched with. */
interface Cached {
  series: Series | null
  maxPoints: number
}

/** Fetched data is good enough if it was fetched with at least as many points. */
function satisfies(cached: Cached | undefined, maxPoints: number): boolean {
  if (!cached) return false
  if (maxPoints === 0) return true
  return cached.maxPoints !== 0 && cached.maxPoints >= maxPoints
}

function storageKey(documentKey: string | null | undefined, id: string): string {
  return `md-render:plot:${documentKey ?? ''}:${id}`
}

function rememberedView(documentKey: string | null | undefined, id: string | null): string | null {
  if (!id) return null
  try {
    return localStorage.getItem(storageKey(documentKey, id))
  } catch {
    return null
  }
}

function useThemePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() => readPalette())
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setPalette(readPalette(root)))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'style'] })
    return () => observer.disconnect()
  }, [])
  return palette
}

function ErrorFigure({ title, message, source }: { title: string; message: string; source?: string }) {
  return (
    <figure className="experiment-plot experiment-plot--error" role="alert" aria-label="Plot error">
      <figcaption>{title}</figcaption>
      <p className="experiment-plot-error-message">{message}</p>
      {source !== undefined && (
        <pre>
          <code className="language-json">{source}</code>
        </pre>
      )}
    </figure>
  )
}

/** A `<plot>` block: parses the JSON, fetches runs and series, draws the chart. */
export function ExperimentPlot({ source }: { source: string }) {
  const parsed = useMemo(() => parsePlotBlock(source.trim()), [source])
  if (!parsed.ok) {
    return <ErrorFigure title="Unable to render plot." message={parsed.error} source={source} />
  }
  return <LoadedPlot spec={parsed.spec} warnings={parsed.warnings} />
}

function LoadedPlot({ spec, warnings }: { spec: PlotSpec; warnings: string[] }) {
  const { experiments, baseDir, documentKey } = useContext(PlotContext)
  const palette = useThemePalette()
  const [runs, setRuns] = useState<RunsResponse | null>(null)
  const [error, setError] = useState<ExperimentsError | null>(null)
  const [cache, setCache] = useState<Map<string, Cached>>(() => new Map())
  const [version, setVersion] = useState<string | null>(null)
  const [modifiedMs, setModifiedMs] = useState<number | null>(null)
  const [immutable, setImmutable] = useState(false)
  const [chosen, setChosen] = useState<string | null>(() => rememberedView(documentKey, spec.id))
  const [custom, setCustom] = useState<View | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [overrides, setOverrides] = useState<Overrides>({})
  const [canvasReady, setCanvasReady] = useState<boolean | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const chartTypeRef = useRef<string | null>(null)
  const figureRef = useRef<HTMLElement>(null)

  const sourceKey = JSON.stringify(spec.source)

  // Runs, keys and configs of the database.
  useEffect(() => {
    let cancelled = false
    setRuns(null)
    setError(null)
    setCache(new Map())
    if (!experiments) {
      setError(new ExperimentsError('unavailable', 'Experiment data is not available here. Open this document with mdrender to see the plot.'))
      return
    }
    experiments
      .listRuns(spec.source, baseDir)
      .then((response) => {
        if (cancelled) return
        setRuns(response)
        setVersion(response.version)
        setModifiedMs(response.modified_ms)
        setImmutable(response.immutable)
      })
      .catch((err) => {
        if (!cancelled) setError(ExperimentsError.from(err))
      })
    return () => {
      cancelled = true
    }
    // sourceKey stands for spec.source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiments, baseDir, sourceKey])

  const describe = useMemo(() => describer(spec.descriptions), [spec.descriptions])
  const views = useMemo(() => (runs ? deriveViews(spec, runs.runs) : []), [spec, runs])
  const active = useMemo<View | null>(() => {
    if (custom) return custom
    const found = views.find((v) => v.name === chosen) ?? defaultView(spec, views)
    if (found || !runs) return found
    // Nothing derivable (no run or key matched): a plain view, so the figure can say why.
    return { name: 'all runs', origin: 'derived', group_by: spec.plot_type === 'scatter' ? 'none' : 'run' }
  }, [custom, views, chosen, spec, runs])
  const resolution = useMemo(
    () => (active && runs ? resolveView(active, spec, runs.runs, describe) : null),
    [active, spec, runs, describe],
  )
  const planned = useMemo(() => (resolution ? plannedRequest(spec, resolution) : null), [spec, resolution])

  // Series the active view needs and the cache lacks.
  useEffect(() => {
    if (!experiments || !planned || planned.runs.length === 0 || planned.keys.length === 0) return
    const missingRuns = new Set<string>()
    const missingKeys = new Set<string>()
    for (const run of planned.runs) {
      for (const key of planned.keys) {
        if (!satisfies(cache.get(seriesKey(run, key)), planned.maxPoints)) {
          missingRuns.add(run)
          missingKeys.add(key)
        }
      }
    }
    if (missingRuns.size === 0) return
    let cancelled = false
    experiments
      .fetchSeries({
        source: spec.source,
        baseDir,
        runs: [...missingRuns],
        keys: [...missingKeys],
        maxPoints: planned.maxPoints,
        keepDuplicateSteps: spec.dedupe_steps === 'none',
      })
      .then((response) => {
        if (cancelled || isUnchanged(response)) return
        setCache((previous) => {
          const next = new Map(previous)
          for (const s of response.series) next.set(seriesKey(s.run, s.key), { series: s, maxPoints: planned.maxPoints })
          for (const m of response.missing) next.set(seriesKey(m.run, m.key), { series: null, maxPoints: planned.maxPoints })
          return next
        })
        setVersion(response.version)
        setModifiedMs(response.modified_ms)
        setImmutable(response.immutable)
      })
      .catch((err) => {
        if (!cancelled) setError(ExperimentsError.from(err))
      })
    return () => {
      cancelled = true
    }
  }, [experiments, planned, cache, spec.source, spec.dedupe_steps, baseDir])

  // Re-fetch while the database changes: only when visible, and with
  // "auto" only while training wrote in the last ten minutes.
  useEffect(() => {
    if (!experiments || !planned || spec.refresh === 0) return
    const interval = spec.refresh === 'auto' ? AUTO_REFRESH_MS : spec.refresh * 1000
    let visible = true
    const observer =
      typeof IntersectionObserver === 'undefined' || !figureRef.current
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting)
          })
    if (observer && figureRef.current) observer.observe(figureRef.current)

    const tick = async () => {
      if (!visible || document.visibilityState === 'hidden') return
      if (spec.refresh === 'auto' && modifiedMs !== null && Date.now() - modifiedMs > AUTO_REFRESH_WINDOW_MS) return
      try {
        const response = await experiments.fetchSeries({
          source: spec.source,
          baseDir,
          runs: planned.runs,
          keys: planned.keys,
          maxPoints: planned.maxPoints,
          keepDuplicateSteps: spec.dedupe_steps === 'none',
          ifVersion: version ?? undefined,
        })
        if (isUnchanged(response)) {
          setModifiedMs(response.modified_ms)
          return
        }
        const fresh = new Map<string, Cached>()
        for (const s of response.series) fresh.set(seriesKey(s.run, s.key), { series: s, maxPoints: planned.maxPoints })
        for (const m of response.missing) fresh.set(seriesKey(m.run, m.key), { series: null, maxPoints: planned.maxPoints })
        setCache(fresh)
        setVersion(response.version)
        setModifiedMs(response.modified_ms)
        // New runs or keys may have appeared.
        setRuns(await experiments.listRuns(spec.source, baseDir))
      } catch {
        // A failed poll leaves the chart as it is; the next one tries again.
      }
    }
    const handle = setInterval(() => void tick(), interval)
    return () => {
      clearInterval(handle)
      observer?.disconnect()
    }
  }, [experiments, planned, spec.refresh, spec.source, spec.dedupe_steps, baseDir, version, modifiedMs])

  const seriesMap = useMemo(() => {
    const map = new Map<string, Series>()
    for (const [key, cached] of cache) if (cached.series) map.set(key, cached.series)
    return map
  }, [cache])

  const built = useMemo(() => {
    if (!active || !resolution || !runs || resolution.empty) return null
    return buildChart({ spec, view: active, resolution, series: seriesMap, runs: runs.runs, palette, hidden, overrides })
  }, [spec, active, resolution, runs, seriesMap, palette, hidden, overrides])

  // Draw, or redraw in place when only the data or colours changed.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!built || !canvas) return
    let cancelled = false
    if (canvasReady === null) {
      const context = canvas.getContext('2d')
      setCanvasReady(Boolean(context))
      if (!context) return
    } else if (!canvasReady) {
      return
    }
    void loadChart().then((ChartClass) => {
      if (cancelled) return
      const existing = chartRef.current
      const samePlugins = (existing?.config.plugins?.length ?? 0) === (built.config.plugins?.length ?? 0)
      if (existing && chartTypeRef.current === built.config.type && samePlugins) {
        existing.data = built.config.data
        existing.options = built.config.options ?? {}
        existing.update('none')
        return
      }
      existing?.destroy()
      chartRef.current = new ChartClass(canvas, built.config)
      chartTypeRef.current = built.config.type
    })
    return () => {
      cancelled = true
    }
  }, [built, canvasReady])

  useEffect(() => () => chartRef.current?.destroy(), [])

  const selectView = useCallback(
    (name: string) => {
      setCustom(null)
      setChosen(name)
      setHidden(new Set())
      if (spec.id) {
        try {
          localStorage.setItem(storageKey(documentKey, spec.id), name)
        } catch {
          // Remembering the view is a convenience only.
        }
      }
    },
    [documentKey, spec.id],
  )

  const toggle = useCallback((id: string) => {
    setHidden((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (error) {
    const title = error.code === 'unavailable' ? 'Plot not available.' : 'Unable to load experiment data.'
    return <ErrorFigure title={title} message={error.message} />
  }

  const caption = spec.title || active?.name || 'Experiment plot'
  const singleKey = resolution && resolution.keys.length === 1 ? resolution.keys[0] : null
  const axes = active ? effectiveAxes(spec, active, overrides) : null
  const legendEntries = built?.legend ?? []
  const legendPosition = spec.legend === 'right' ? 'right' : 'bottom'
  const showLegend = spec.legend !== 'none' && !(spec.legend === 'auto' && legendEntries.length > 24) && legendEntries.length > 1
  const notes = [...warnings, ...(built?.notes ?? [])]
  if (immutable) notes.push('Read as a snapshot: the database is being written, so the newest rows may be missing.')
  const allLoaded = Boolean(planned && planned.runs.every((r) => planned.keys.every((k) => satisfies(cache.get(seriesKey(r, k)), planned.maxPoints))))

  return (
    <figure
      ref={figureRef}
      className={`experiment-plot experiment-plot--${spec.plot_type}`}
      aria-label={`Plot: ${caption}`}
      data-testid="experiment-plot"
    >
      <div className="experiment-plot-caption">
        {singleKey && caption === singleKey ? (
          <MetricHint metric={singleKey} description={describe(singleKey)}>
            <span className="experiment-plot-title" tabIndex={describe(singleKey) ? 0 : undefined}>
              {caption}
            </span>
          </MetricHint>
        ) : (
          <span className="experiment-plot-title">{caption}</span>
        )}
        {singleKey && caption !== singleKey && (
          <MetricHint metric={singleKey} description={describe(singleKey)}>
            <span className="experiment-plot-key" tabIndex={describe(singleKey) ? 0 : undefined}>
              {singleKey}
            </span>
          </MetricHint>
        )}
      </div>

      {runs && active && (
        <div className="experiment-plot-toolbar">
          <PlotViewPicker
            views={views}
            active={active}
            configKeys={configCandidates(runs.runs)}
            onSelect={selectView}
            onCustom={(view) => {
              setCustom(view)
              setHidden(new Set())
            }}
          />
          {spec.plot_type === 'line' && axes && (
            <>
              <label className="plot-control">
                <span className="plot-control-label">x</span>
                <select
                  value={axes.x.axis}
                  onChange={(e) => setOverrides((o) => ({ ...o, axis: e.target.value as Overrides['axis'] }))}
                >
                  <option value="step">step</option>
                  <option value="time">time</option>
                  <option value="relative">elapsed</option>
                </select>
              </label>
              <label className="plot-control plot-control--range">
                <span className="plot-control-label">smooth</span>
                <input
                  type="range"
                  min={0}
                  max={0.99}
                  step={0.01}
                  value={axes.y.smoothing}
                  onChange={(e) => setOverrides((o) => ({ ...o, smoothing: Number(e.target.value) }))}
                  aria-label="Smoothing"
                />
              </label>
            </>
          )}
          {axes && (spec.plot_type === 'line' || spec.plot_type === 'bar' || spec.plot_type === 'scatter') && (
            <label className="plot-control plot-control--check">
              <input
                type="checkbox"
                checked={axes.y.scale === 'log'}
                onChange={(e) => setOverrides((o) => ({ ...o, scale: e.target.checked ? 'log' : 'linear' }))}
              />
              <span className="plot-control-label">log</span>
            </label>
          )}
        </div>
      )}

      {!runs && <p className="experiment-plot-status">Reading runs…</p>}
      {resolution?.empty && (
        <p className="experiment-plot-status" role="status">
          {resolution.empty} Runs here: {runs!.runs.slice(0, 10).map((r) => r.name).join(', ')}
          {runs!.runs.length > 10 ? ` and ${runs!.runs.length - 10} more` : ''}.
        </p>
      )}

      {built && (
        <div className={`experiment-plot-body experiment-plot-body--legend-${showLegend ? legendPosition : 'none'}`}>
          <div className="experiment-plot-canvas" style={{ height: spec.height }} aria-busy={!allLoaded}>
            {canvasReady !== false && <canvas ref={canvasRef} role="img" aria-label={caption} />}
            {canvasReady === false && <p className="experiment-plot-status">Charts need a canvas; the values are in the table below.</p>}
            {!allLoaded && <span className="experiment-plot-loading">Loading…</span>}
          </div>
          {showLegend && <PlotLegend entries={legendEntries} onToggle={toggle} position={legendPosition} />}
        </div>
      )}

      {spec.caption && <PlotCaption text={spec.caption} />}

      {/* Shown for up to MAX_TABLE_ROWS series unless the block decides; it
          also stands in for the chart where no canvas can draw. */}
      {built && (showsTable(spec.table, built.table.length) || canvasReady === false) && (
        <details className="experiment-plot-table" open={canvasReady === false}>
          <summary>Data</summary>
          <div className="experiment-plot-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col">Metric</th>
                  <th scope="col">n</th>
                  <th scope="col">last</th>
                  <th scope="col">min</th>
                  <th scope="col">max</th>
                  <th scope="col">mean</th>
                </tr>
              </thead>
              <tbody>
                {built.table.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>
                      <MetricHint metric={row.key} description={row.description}>
                        <code tabIndex={row.description ? 0 : undefined}>{row.key}</code>
                      </MetricHint>
                    </td>
                    <td>{row.n}</td>
                    <td>{formatNumber(row.last)}</td>
                    <td>{formatNumber(row.min)}</td>
                    <td>{formatNumber(row.max)}</td>
                    <td>{formatNumber(row.mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {notes.length > 0 && (
        <ul className="experiment-plot-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </figure>
  )
}
