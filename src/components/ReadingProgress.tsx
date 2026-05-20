import { useState, useEffect, type RefObject } from 'react'

interface ReadingProgressProps {
  /** The scroll container whose progress is tracked. */
  containerRef: RefObject<HTMLElement | null>
  /** Changes here (e.g. document content) trigger a recompute. */
  resetKey: unknown
}

/** Thin accent bar pinned to the top of the reading pane, tracking scroll. */
export function ReadingProgress({ containerRef, resetKey }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let frame = 0
    const measure = () => {
      frame = 0
      const scrollable = el.scrollHeight - el.clientHeight
      setProgress(scrollable > 0 ? Math.min(1, el.scrollTop / scrollable) : 0)
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [containerRef, resetKey])

  return (
    <div className="reading-progress" aria-hidden="true">
      <div
        className="reading-progress-fill"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  )
}
