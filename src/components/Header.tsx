import { motion } from 'framer-motion'
import type { DocumentMeta } from '../lib/backend'

interface TabBarProps {
  documents: DocumentMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

/**
 * Tab strip across the top, shown when more than one document is open. Both
 * modes build it the same way: every file (and every markdown file found under
 * a directory argument) is one tab, and each tab closes individually via its
 * own ✕. With a single document the strip stays hidden — a lone tab is noise,
 * and it also means the last document cannot be closed from here.
 */
export function TabBar({ documents, activeId, onSelect, onClose }: TabBarProps) {
  if (documents.length < 2) return null

  return (
    <nav className="tab-bar" role="tablist" aria-label="Open documents">
      {documents.map((document) => {
        const isActive = document.id === activeId
        return (
          <div key={document.id} className={`tab ${isActive ? 'is-active' : ''}`}>
            <motion.button
              role="tab"
              type="button"
              className="tab-select"
              aria-selected={isActive}
              title={document.path}
              onClick={() => onSelect(document.id)}
              whileTap={{ scale: 0.98 }}
            >
              {document.label}
            </motion.button>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${document.label}`}
              title={`Close ${document.label}`}
              onClick={() => onClose(document.id)}
            >
              ×
            </button>
          </div>
        )
      })}
    </nav>
  )
}
