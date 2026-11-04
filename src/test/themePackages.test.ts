import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { themes as builtins, validateTheme, type ThemeDefinition } from '../lib/themes'
import { checkPackages, rewriteThemeUrls, type RawPackage } from '../lib/themePackages'

const ROOT = path.resolve(__dirname, '../../themes')
const packages = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

function themesOf(name: string): unknown[] {
  return JSON.parse(readFileSync(path.join(ROOT, name, 'theme.json'), 'utf8')).themes
}

/** WCAG contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const ch = (o: number) => {
      const v = parseInt(hex.slice(o, o + 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the theme packages in ./themes', () => {
  it('holds the fifteen themes that left the app', () => {
    expect(packages).toEqual([
      'claude', 'evergreen', 'forest', 'latex', 'midnight-ink', 'newsprint',
      'nocturne', 'paradigm', 'plain', 'ponder', 'sonnet', 'warm-paper',
    ])
    expect(packages.flatMap((name) => themesOf(name)).length).toBe(15)
  })

  it('gives every theme valid, complete variables and a unique id', () => {
    const ids = new Set(builtins.map((t) => t.id))
    for (const name of packages) {
      for (const raw of themesOf(name)) {
        const theme = validateTheme(raw)
        expect(typeof theme, `${name}: ${String(theme)}`).toBe('object')
        const { id } = theme as ThemeDefinition
        expect(ids.has(id), `${id} is taken twice`).toBe(false)
        expect(id.startsWith('claudette'), id).toBe(false)
        ids.add(id)
      }
    }
  })

  it('keeps body text readable: at least 4.5:1 against the page', () => {
    for (const name of packages) {
      for (const raw of themesOf(name)) {
        const t = validateTheme(raw) as ThemeDefinition
        const ratio = contrast(t.vars['--text-primary'], t.vars['--bg-primary'])
        expect(ratio, `${t.id}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('scopes every rule to its own ids, never by prefix', () => {
    for (const name of packages) {
      const file = path.join(ROOT, name, 'theme.css')
      if (!existsSync(file)) continue
      const css = readFileSync(file, 'utf8')
      expect(css, name).not.toMatch(/data-theme\^=/)
      const own = new Set((themesOf(name) as Array<{ id: string }>).map((t) => t.id))
      for (const m of css.matchAll(/data-theme="([^"]+)"/g)) {
        expect(own.has(m[1]), `${name} styles ${m[1]}`).toBe(true)
      }
    }
  })

  it('points every url() in a stylesheet at a file in the package or the web', () => {
    for (const name of packages) {
      const file = path.join(ROOT, name, 'theme.css')
      if (!existsSync(file)) continue
      for (const m of readFileSync(file, 'utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (/^https:\/\//.test(m[1])) continue
        expect(existsSync(path.join(ROOT, name, m[1])), `${name}: ${m[1]}`).toBe(true)
      }
    }
  })

  it('bundles New Computer Modern, with its licence, in the LaTeX package', () => {
    const fonts = readdirSync(path.join(ROOT, 'latex/fonts'))
    expect(fonts.filter((f) => f.endsWith('.woff2'))).toHaveLength(5)
    expect(fonts).toContain('GUST-FONT-LICENSE.txt')
    const css = readFileSync(path.join(ROOT, 'latex/theme.css'), 'utf8')
    expect(css.match(/url\('fonts\/mdr-newcm[^']+\.woff2'\)/g)).toHaveLength(5)
    const latex = validateTheme(themesOf('latex')[0]) as ThemeDefinition
    expect(latex.vars['--font-body']).toMatch(/^"MDR New Computer Modern"/)
  })
})

describe('loading installed packages', () => {
  const pkg = (name: string, themes: unknown[], css = true): RawPackage => ({ package: name, themes, css })
  const latex = themesOf('latex')

  it('keeps valid themes, skips broken ones and ids already taken', () => {
    const loaded = checkPackages(
      [
        pkg('latex', latex),
        pkg('broken', [{ id: 'Bad Id', name: 'x', mode: 'light', vars: {} }, { id: 'half', name: 'Half', mode: 'light', vars: { '--bg-primary': '#fff' } }]),
        pkg('copycat', [{ ...(latex[0] as object) }, { ...(builtins[0] as object) }], false),
      ],
      (p) => ({ href: `/api/themes/${p.package}/theme.css` }),
    )
    expect(loaded.map((p) => [p.package, p.themes.map((t) => t.id)])).toEqual([['latex', ['latex', 'latex-dark']]])
    expect(loaded[0].style).toEqual({ href: '/api/themes/latex/theme.css' })
  })

  it('gives a package without theme.css no stylesheet', () => {
    const loaded = checkPackages([pkg('plain', themesOf('plain'), false)], () => ({ href: 'x' }))
    expect(loaded[0].style).toBeNull()
  })

  it('points relative url()s in a stylesheet at the package folder', () => {
    const css = "@import url('https://fonts.example/a.css');\nsrc: url('fonts/a.woff2'), url(\"b.woff2\"), url(c.png), url(data:font/woff2;base64,AA), url(#x);"
    expect(rewriteThemeUrls(css, (rel) => `asset://pkg/${rel}`)).toBe(
      "@import url('https://fonts.example/a.css');\nsrc: url('asset://pkg/fonts/a.woff2'), url(\"asset://pkg/b.woff2\"), url('asset://pkg/c.png'), url(data:font/woff2;base64,AA), url(#x);",
    )
  })
})
