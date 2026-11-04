/**
 * Installed theme packages (themes/README.md): what the backend lists,
 * checked and turned into themes the picker can offer, plus the stylesheet
 * each package brings. The server serves a package's files at
 * /api/themes/<package>/..., so its theme.css is linked as-is; the desktop
 * app reads theme.css and points its relative url()s at the package folder.
 */

import { themes as builtins, validateTheme, type ThemeDefinition } from './themes'

/** How a package's rules reach the page. */
export type ThemeStyle = { href: string } | { css: () => Promise<string> }

export interface LoadedPackage {
  package: string
  themes: ThemeDefinition[]
  style: ThemeStyle | null
}

/** A package as the backend lists it, before its themes are checked. */
export interface RawPackage {
  package: string
  themes: unknown[]
  css: boolean
  dir?: string
}

/**
 * Check every theme of every package; drop invalid ones and ids already
 * taken (by a built-in or an earlier package), with a console warning.
 */
export function checkPackages(raw: RawPackage[], style: (pkg: RawPackage) => ThemeStyle | null): LoadedPackage[] {
  const taken = new Set(builtins.map((t) => t.id))
  const out: LoadedPackage[] = []
  for (const pkg of raw) {
    const valid: ThemeDefinition[] = []
    for (const entry of Array.isArray(pkg.themes) ? pkg.themes : []) {
      const theme = validateTheme(entry)
      if (typeof theme === 'string') {
        console.warn(`md-render: theme package ${pkg.package}: ${theme}`)
      } else if (taken.has(theme.id)) {
        console.warn(`md-render: theme package ${pkg.package}: id ${theme.id} is already taken`)
      } else {
        taken.add(theme.id)
        valid.push(theme)
      }
    }
    if (valid.length) out.push({ package: pkg.package, themes: valid, style: pkg.css ? style(pkg) : null })
  }
  return out
}

/**
 * Point a stylesheet's relative url()s somewhere else. Absolute URLs,
 * data: URIs and fragments are left alone.
 */
export function rewriteThemeUrls(css: string, resolve: (relative: string) => string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, quote: string, target: string) => {
    if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) return whole
    return `url(${quote || "'"}${resolve(target)}${quote || "'"})`
  })
}

const attached = new Map<string, Promise<void>>()

/** Add a package's stylesheet to the page once. */
export function attachThemeStyle(pkg: LoadedPackage): Promise<void> {
  if (!pkg.style || typeof document === 'undefined') return Promise.resolve()
  const id = `md-render-theme-${pkg.package}`
  const existing = attached.get(id)
  if (existing) return existing
  const style = pkg.style
  const done = (async () => {
    if ('href' in style) {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = style.href
      document.head.appendChild(link)
    } else {
      const element = document.createElement('style')
      element.id = id
      element.textContent = await style.css()
      document.head.appendChild(element)
    }
  })()
  attached.set(id, done)
  done.catch(() => attached.delete(id))
  return done
}
