import { motion } from 'framer-motion'
import type { DocumentMeta } from '../lib/backend'

interface TabBarProps {
  documents: DocumentMeta[]
  activeId: string | null
  onSelect: (id: string) => void
}

/**
 * Tab strip across the top, shown when more than one document is open. Server
 * mode opens one tab per file (and per markdown file found under a directory
 * argument); the desktop app opens one document at a time, so this stays
 * hidden there.
 */
export function TabBar({ documents, activeId, onSelect }: TabBarProps) {
  if (documents.length < 2) return null

  return (
    <nav className="tab-bar" role="tablist" aria-label="Open documents">
      {documents.map((document) => {
        const isActive = document.id === activeId
        return (
          <motion.button
            key={document.id}
            role="tab"
            type="button"
            className={`tab ${isActive ? 'is-active' : ''}`}
            aria-selected={isActive}
            title={document.path}
            onClick={() => onSelect(document.id)}
            whileTap={{ scale: 0.98 }}
          >
            {document.label}
          </motion.button>
        )
      })}
    </nav>
  )
}
