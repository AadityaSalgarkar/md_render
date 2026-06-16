import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Mermaid, MermaidConfig, RenderResult } from 'mermaid'

interface MermaidDiagramProps {
  chart: string
}

interface RenderedDiagram {
  chart: string
  svg: string
  bindFunctions?: RenderResult['bindFunctions']
}

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'neutral',
}

let mermaidPromise: Promise<Mermaid> | null = null
let mermaidInitialized = false

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      if (!mermaidInitialized) {
        mermaid.initialize(MERMAID_CONFIG)
        mermaidInitialized = true
      }
      return mermaid
    })
  }
  return mermaidPromise
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const normalizedChart = chart.trim()
  const reactId = useId()
  const diagramId = useMemo(
    () => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId],
  )
  const [rendered, setRendered] = useState<RenderedDiagram | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const activeRendered = rendered?.chart === normalizedChart ? rendered : null

  useEffect(() => {
    let cancelled = false

    setRendered(null)
    setRenderError(null)

    if (!normalizedChart) {
      setRenderError('The Mermaid diagram is empty.')
      return () => {
        cancelled = true
      }
    }

    const renderDiagram = async () => {
      try {
        const mermaid = await loadMermaid()
        await mermaid.parse(normalizedChart)
        const result = await mermaid.render(diagramId, normalizedChart)
        if (!cancelled) {
          setRendered({
            chart: normalizedChart,
            svg: result.svg,
            bindFunctions: result.bindFunctions,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setRenderError(getErrorMessage(error))
        }
      }
    }

    void renderDiagram()

    return () => {
      cancelled = true
    }
  }, [normalizedChart, diagramId])

  useEffect(() => {
    if (!activeRendered || !containerRef.current) return
    activeRendered.bindFunctions?.(containerRef.current)
  }, [activeRendered])

  if (renderError) {
    return (
      <figure
        className="mermaid-diagram mermaid-diagram--error"
        role="alert"
        aria-label="Mermaid diagram error"
      >
        <figcaption>Unable to render Mermaid diagram.</figcaption>
        <p className="mermaid-error-message">{renderError}</p>
        <pre>
          <code className="language-mermaid">{chart}</code>
        </pre>
      </figure>
    )
  }

  return (
    <figure className="mermaid-diagram" aria-label="Mermaid diagram">
      <div
        ref={containerRef}
        className="mermaid-diagram-frame"
        data-testid="mermaid-diagram"
        aria-busy={activeRendered ? undefined : true}
        dangerouslySetInnerHTML={activeRendered ? { __html: activeRendered.svg } : undefined}
      />
      {!activeRendered && <div className="mermaid-loading">Rendering diagram...</div>}
    </figure>
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown Mermaid rendering error.'
}
