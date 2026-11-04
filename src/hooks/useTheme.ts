import { useState, useLayoutEffect, useEffect, useCallback, useRef } from 'react'
import { themes as builtins, getTheme, resolveTheme, THEME_VARS, type ThemeDefinition } from '../lib/themes'
import { attachThemeStyle, type LoadedPackage } from '../lib/themePackages'

const STORAGE_KEY = 'md-render-theme'
/** The stored theme's mode, so the server's listing page can match it. */
const MODE_KEY = 'md-render-theme-mode'

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function storedId(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
}

/**
 * Applies a theme by writing its CSS custom properties onto `<html>` and
 * tagging it with `data-theme` (for per-theme rules) and `data-mode`.
 *
 * The built-in themes are known at once; installed packages arrive from
 * `loadThemes`. Until they do, a stored id that is not built in is kept
 * pending (Claudette shows meanwhile) and storage is left alone, so a chosen
 * installed theme survives the reload. If the package is gone, Claudette
 * stays and becomes the stored choice.
 */
export function useTheme(loadThemes?: () => Promise<LoadedPackage[]>) {
  const [registry, setRegistry] = useState<ThemeDefinition[]>(builtins)
  const [theme, setThemeState] = useState<ThemeDefinition>(() => resolveTheme(storedId(), prefersDark()))
  // An id asked for before the installed themes were known.
  const pending = useRef<string | null>(getTheme(storedId()) ? null : storedId())
  const packages = useRef<LoadedPackage[]>([])
  const loaded = useRef(!loadThemes)
  const registryRef = useRef(registry)
  registryRef.current = registry

  // Run before paint so the document never flashes the wrong palette.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme.id
    root.dataset.mode = theme.mode
    for (const name of THEME_VARS) {
      root.style.setProperty(name, theme.vars[name])
    }
    const pkg = packages.current.find((p) => p.themes.some((t) => t.id === theme.id))
    if (pkg) void attachThemeStyle(pkg).catch((err) => console.warn('md-render: theme stylesheet', err))
    if (pending.current === null) {
      localStorage.setItem(STORAGE_KEY, theme.id)
      localStorage.setItem(MODE_KEY, theme.mode)
    }
  }, [theme])

  useEffect(() => {
    if (!loadThemes) {
      pending.current = null
      loaded.current = true
      return
    }
    let cancelled = false
    loadThemes()
      .catch((err) => {
        console.warn('md-render: could not list installed themes', err)
        return [] as LoadedPackage[]
      })
      .then((found) => {
        if (cancelled) return
        loaded.current = true
        packages.current = found
        const all = [...builtins, ...found.flatMap((p) => p.themes)]
        registryRef.current = all
        setRegistry(all)
        const wanted = pending.current
        pending.current = null
        const next = wanted ? getTheme(wanted, all) : undefined
        // A new object either way, so the layout effect runs and stores it.
        setThemeState((current) => ({ ...(next ?? current) }))
      })
    return () => {
      cancelled = true
    }
  }, [loadThemes])

  const setTheme = useCallback((id: string) => {
    const next = getTheme(id, registryRef.current)
    if (next) {
      pending.current = null
      setThemeState(next)
    } else if (!loaded.current) {
      // Installed themes not loaded yet: apply this one when they are.
      pending.current = id
    }
  }, [])

  return { themeId: theme.id, theme, setTheme, themes: registry }
}
