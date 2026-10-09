import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PlotContext } from '../lib/plots/context'
import { TikzError, sanitizeSvg, tikzCaption } from '../lib/tikz'
import { PlotCaption } from './PlotCaption'

/** Wait this long after the last edit before compiling again. */
export const TIKZ_DEBOUNCE_MS = 600

interface Shown {
  source: string
  svg: string
}

/**
 * A ```tikz block. The first render compiles at once; later edits wait for
 * a pause in typing, and the previous drawing stays on screen until the new
 * one arrives, so the figure never blanks while it recompiles.
 */
export function TikzDiagram({ source }: { source: string }) {
  const { tikz } = useContext(PlotContext)
  const trimmed = source.trim()
  const [shown, setShown] = useState<Shown | null>(null)
  const [error, setError] = useState<TikzError | null>(null)
  const [pending, setPending] = useState(true)
  const firstRun = useRef(true)
  const caption = useMemo(() => tikzCaption(trimmed), [trimmed])

  useEffect(() => {
    let cancelled = false
    if (!tikz) {
      setError(new TikzError('unavailable', 'TikZ diagrams need mdrender to compile them. Open this document with mdrender.'))
      setPending(false)
      return
    }
    if (!trimmed) {
      setError(new TikzError('tex', 'The TikZ block is empty.'))
      setPending(false)
      return
    }
    setPending(true)
    const delay = firstRun.current ? 0 : TIKZ_DEBOUNCE_MS
    firstRun.current = false
    const timer = setTimeout(() => {
      tikz
        .render(trimmed)
        .then((rendered) => {
          if (cancelled) return
          const svg = sanitizeSvg(rendered.svg)
          if (svg === null) {
            setError(new TikzError('engine', 'The compiler did not return an SVG.'))
          } else {
            setShown({ source: trimmed, svg })
            setError(null)
          }
        })
        .catch((err) => {
          if (!cancelled) setError(TikzError.from(err))
        })
        .finally(() => {
          if (!cancelled) setPending(false)
        })
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tikz, trimmed])

  if (error && !(pending && shown)) {
    return (
      <figure className="tikz-figure tikz-figure--error" role="alert" aria-label="TikZ error">
        <figcaption>{error.code === 'unavailable' ? 'TikZ not available here.' : 'Unable to render TikZ diagram.'}</figcaption>
        <p className="tikz-error-message">{error.message}</p>
        {error.log.length > 0 && (
          <pre className="tikz-error-log">
            <code>{error.log.join('\n')}</code>
          </pre>
        )}
        <details className="tikz-error-source">
          <summary>Source</summary>
          <pre>
            <code className="language-latex">{source}</code>
          </pre>
        </details>
      </figure>
    )
  }

  const stale = Boolean(shown && shown.source !== trimmed)
  return (
    <figure
      className={`tikz-figure${shown ? '' : ' tikz-figure--loading'}`}
      aria-label="TikZ diagram"
      aria-busy={pending || undefined}
      data-testid="tikz-diagram"
    >
      {shown ? (
        <div
          className={`tikz-frame${stale ? ' is-stale' : ''}`}
          // Sanitised by sanitizeSvg: drawing elements only, no scripts or handlers.
          dangerouslySetInnerHTML={{ __html: shown.svg }}
        />
      ) : (
        <div className="tikz-loading">Compiling diagram…</div>
      )}
      {caption && <PlotCaption text={caption} />}
    </figure>
  )
}
