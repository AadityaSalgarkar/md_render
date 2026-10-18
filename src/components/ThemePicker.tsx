import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { themeSwatch, type ThemeDefinition, type ThemeMode } from '../lib/themes'

interface ThemePickerProps {
  themes: ThemeDefinition[]
  activeId: string
  onSelect: (id: string) => void
}

const GROUP_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
}

const GROUPS: ThemeMode[] = ['light', 'dark']

/**
 * The theme menu: a compact dropdown, light themes then dark, each row the
 * theme's main colours as filled squares and its name. Arrow keys, Home and
 * End move through it; Enter picks; Escape closes.
 */
export function ThemePicker({ themes, activeId, onSelect }: ThemePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // In display order, so the keys move the way the eye reads.
  const ordered = GROUPS.flatMap((mode) => themes.filter((t) => t.mode === mode))

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  // Dismiss on an outside click.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, close])

  // Opening lands on the active theme, scrolled into view.
  useEffect(() => {
    if (!open) return
    const active = listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    const first = listRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
    const target = active ?? first
    target?.focus()
    target?.scrollIntoView?.({ block: 'nearest' })
  }, [open])

  const items = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])

  const onListKeyDown = (e: React.KeyboardEvent) => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    switch (e.key) {
      case 'ArrowDown':
        next = (at + 1) % all.length
        break
      case 'ArrowUp':
        next = (at - 1 + all.length) % all.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = all.length - 1
        break
      case 'Escape':
        e.preventDefault()
        close(true)
        return
      case 'Tab':
        close(false)
        return
      default:
        return
    }
    e.preventDefault()
    all[next]?.focus()
  }

  const handleSelect = (id: string) => {
    onSelect(id)
    close(true)
  }

  return (
    <div className="theme-picker" ref={rootRef}>
      <motion.button
        ref={buttonRef}
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
            ref={listRef}
            className="theme-popover"
            role="menu"
            aria-label="Themes"
            onKeyDown={onListKeyDown}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          >
            {GROUPS.map((mode) => {
              const group = ordered.filter((t) => t.mode === mode)
              if (group.length === 0) return null
              return (
                <div className="theme-group" role="group" aria-label={GROUP_LABEL[mode]} key={mode}>
                  <div className="theme-group-label" aria-hidden="true">{GROUP_LABEL[mode]}</div>
                  {group.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={t.id === activeId}
                      className={`theme-option ${t.id === activeId ? 'active' : ''}`}
                      onClick={() => handleSelect(t.id)}
                      title={t.blurb}
                      data-theme-id={t.id}
                    >
                      <span className="theme-squares" aria-hidden="true">
                        {themeSwatch(t).map((color, i) => (
                          <span key={i} className="theme-square" style={{ background: color }} />
                        ))}
                      </span>
                      <span className="theme-option-name">{t.name}</span>
                      {t.id === activeId && <CheckIcon />}
                    </button>
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
    <svg className="theme-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
