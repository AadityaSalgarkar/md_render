import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface MetricHintProps {
  /** The metric key, shown in monospace at the top of the popover. */
  metric: string
  /** What the metric means; without one the children render plainly. */
  description: string | null
  children: ReactNode
}

/** Delay before the popover appears, so passing the pointer over does nothing. */
export const HINT_DELAY_MS = 250

/**
 * A quiet popover with a metric's description, on hover or keyboard focus.
 * Nothing is drawn inline: the children look the same with or without a
 * description.
 */
export function MetricHint({ metric, description, children }: MetricHintProps) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  if (!description) return <>{children}</>

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), HINT_DELAY_MS)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setOpen(false)
  }

  return (
    <span
      className="metric-hint"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span className="metric-hint-popover" role="tooltip" id={id}>
          <span className="metric-hint-key">{metric}</span>
          <span className="metric-hint-text">{description}</span>
        </span>
      )}
    </span>
  )
}
