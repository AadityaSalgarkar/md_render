import { motion } from 'framer-motion'
import type { Theme } from '../types'

interface HeaderProps {
  theme: Theme
  onToggleTheme: () => void
  isEditorCollapsed: boolean
  onToggleEditor: () => void
}

export function Header({ theme, onToggleTheme, isEditorCollapsed, onToggleEditor }: HeaderProps) {
  return (
    <header className="app-header px-4 py-2 flex items-center justify-end">
      <div className="flex items-center gap-2">
        <motion.button
          className="toggle-button"
          onClick={onToggleEditor}
          whileTap={{ scale: 0.95 }}
          aria-label={isEditorCollapsed ? 'Show editor' : 'Hide editor'}
          title={isEditorCollapsed ? 'Show editor' : 'Hide editor'}
        >
          <motion.div
            initial={false}
            animate={{ rotateY: isEditorCollapsed ? 180 : 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <PanelLeftIcon />
          </motion.div>
          <span className="toggle-label">
            {isEditorCollapsed ? 'Edit' : 'Read'}
          </span>
        </motion.button>

        <motion.button
          className="theme-toggle"
          onClick={onToggleTheme}
          whileTap={{ scale: 0.95 }}
          aria-label="Cycle through themes"
        >
          <motion.div
            initial={false}
            animate={{ rotate: theme !== 'light' ? 180 : 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            {theme === 'light' ? (
              <SunIcon />
            ) : (
              <SunIcon />
            )}
          </motion.div>
        </motion.button>
      </div>
    </header>
  )
}

function PanelLeftIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

