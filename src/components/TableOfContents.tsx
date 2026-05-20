import { motion } from 'framer-motion'
import type { Heading } from '../types'

interface TableOfContentsProps {
  headings: Heading[]
  activeId: string | null
  open: boolean
  onNavigate: (id: string) => void
}

const COLLAPSED_WIDTH = 0
const EXPANDED_WIDTH = 264

export function TableOfContents({ headings, activeId, open, onNavigate }: TableOfContentsProps) {
  const minLevel = headings.length
    ? Math.min(...headings.map((h) => h.level))
    : 1

  return (
    <motion.aside
      className="toc-sidebar"
      aria-label="Document index"
      initial={false}
      animate={{
        width: open ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        opacity: open ? 1 : 0,
      }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      <div className="toc-inner">
        <div className="toc-heading">
          <IndexIcon />
          <span>Index</span>
        </div>

        {headings.length === 0 ? (
          <p className="toc-empty">
            Add headings (<code># Title</code>) to grow an index.
          </p>
        ) : (
          <nav className="toc-nav">
            <ul>
              {headings.map((h) => (
                <li key={h.id} style={{ paddingLeft: `${(h.level - minLevel) * 0.85}rem` }}>
                  <button
                    type="button"
                    className={`toc-link toc-level-${h.level} ${
                      h.id === activeId ? 'active' : ''
                    }`}
                    aria-current={h.id === activeId ? 'true' : undefined}
                    onClick={() => onNavigate(h.id)}
                  >
                    <span className="toc-tick" aria-hidden="true" />
                    <span className="toc-text">{h.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </motion.aside>
  )
}

function IndexIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.5" y2="6" />
      <line x1="3" y1="12" x2="3.5" y2="12" />
      <line x1="3" y1="18" x2="3.5" y2="18" />
    </svg>
  )
}
