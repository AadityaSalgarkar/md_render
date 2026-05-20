import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ThemeDefinition, ThemeMode } from '../lib/themes'

interface ThemePickerProps {
  themes: ThemeDefinition[]
  activeId: string
  onSelect: (id: string) => void
}

const GROUP_LABEL: Record<ThemeMode, string> = {
  light: 'Daylight',
  dark: 'After dark',
}

export function ThemePicker({ themes, activeId, onSelect }: ThemePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id)
      setOpen(false)
    },
    [onSelect],
  )

  const groups: ThemeMode[] = ['light', 'dark']

  return (
    <div className="theme-picker" ref={rootRef}>
      <motion.button
        className="floating-btn"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.95 }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose theme"
        title="Theme"
      >
        <PaletteIcon />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="theme-popover"
            role="menu"
            aria-label="Themes"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <div className="theme-popover-title">Themes</div>
            {groups.map((mode) => {
              const items = themes.filter((t) => t.mode === mode)
              if (items.length === 0) return null
              return (
                <div className="theme-group" key={mode}>
                  <div className="theme-group-label">{GROUP_LABEL[mode]}</div>
                  {items.map((t, i) => (
                    <motion.button
                      key={t.id}
                      role="menuitemradio"
                      aria-checked={t.id === activeId}
                      className={`theme-option ${t.id === activeId ? 'active' : ''}`}
                      onClick={() => handleSelect(t.id)}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.03 * i, duration: 0.15 }}
                    >
                      <span
                        className="theme-swatch"
                        style={{ background: t.swatch[0] }}
                        aria-hidden="true"
                      >
                        <span style={{ background: t.swatch[1] }} />
                        <span style={{ background: t.swatch[2] }} />
                      </span>
                      <span className="theme-option-text">
                        <span className="theme-option-name">{t.name}</span>
                        <span className="theme-option-blurb">{t.blurb}</span>
                      </span>
                      {t.id === activeId && <CheckIcon />}
                    </motion.button>
                  ))}
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PaletteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.012 17.5 2 12 2z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="theme-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
