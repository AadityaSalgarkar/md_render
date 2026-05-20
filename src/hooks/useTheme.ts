import { useState, useLayoutEffect, useCallback } from 'react'
import { themes, resolveTheme, THEME_VARS, type ThemeDefinition } from '../lib/themes'

const STORAGE_KEY = 'md-render-theme'

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function initialTheme(): ThemeDefinition {
  const stored =
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  return resolveTheme(stored, prefersDark())
}

/**
 * Applies one of the registered themes by writing its CSS custom properties
 * onto `<html>` and tagging it with `data-theme` (for per-theme texture rules).
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeDefinition>(initialTheme)

  // Run before paint so the document never flashes the wrong palette.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme.id
    root.dataset.mode = theme.mode
    for (const name of THEME_VARS) {
      root.style.setProperty(name, theme.vars[name])
    }
    localStorage.setItem(STORAGE_KEY, theme.id)
  }, [theme])

  const setTheme = useCallback((id: string) => {
    setThemeState((current) => {
      const next = themes.find((t) => t.id === id)
      return next ?? current
    })
  }, [])

  return { themeId: theme.id, theme, setTheme, themes }
}
