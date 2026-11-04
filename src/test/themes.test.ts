import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  themes,
  themeSwatch,
  THEME_VARS,
  getTheme,
  resolveTheme,
  validateTheme,
  DEFAULT_LIGHT,
  DEFAULT_DARK,
} from '../lib/themes'

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('theme registry', () => {
  it('builds in only Claudette, light and dark', () => {
    expect(themes.map((t) => [t.id, t.mode])).toEqual([
      ['claudette', 'light'],
      ['claudette-dark', 'dark'],
    ])
    expect(DEFAULT_LIGHT).toBe('claudette')
    expect(DEFAULT_DARK).toBe('claudette-dark')
  })

  it('defines every required CSS variable for every theme', () => {
    for (const theme of themes) {
      for (const name of THEME_VARS) {
        expect(theme.vars[name], `${theme.id} is missing ${name}`).toBeTruthy()
      }
      expect(validateTheme(theme)).toEqual(theme)
    }
  })

  it('gives every theme a swatch of page, text and accent', () => {
    for (const theme of themes) {
      expect(themeSwatch(theme)).toEqual([
        theme.vars['--bg-primary'],
        theme.vars['--text-primary'],
        theme.vars['--accent'],
      ])
    }
  })

  it('keeps body text readable: at least 4.5:1 against the page', () => {
    for (const theme of themes) {
      const ratio = contrast(theme.vars['--text-primary'], theme.vars['--bg-primary'])
      expect(ratio, `${theme.id}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('pairs the light and dark Claudette with the same name and fonts', () => {
    const light = getTheme('claudette')!
    const dark = getTheme('claudette-dark')!
    expect(dark.name).toBe(light.name)
    for (const font of ['--font-head', '--font-body', '--font-mono'] as const) {
      expect(dark.vars[font]).toBe(light.vars[font])
    }
  })

  it('paints the first frame in Claudette: :root mirrors its variables', () => {
    const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    const root = css.match(/\n:root \{[^}]*\}/)![0]
    const claudette = getTheme('claudette')!
    for (const name of THEME_VARS) {
      expect(root, name).toContain(`${name}: ${claudette.vars[name]};`)
    }
  })

  it('keeps only the Claudette rules in the app stylesheet, and loads only its fonts', () => {
    const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    const ids = [...css.matchAll(/data-theme\^?="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(ids)).toEqual(new Set(['claudette', 'claudette-dark']))
    expect(css).not.toContain('@font-face')
    // Section breaks are a plain rule in Claudette, not the ornament.
    expect(css).toMatch(/\[data-theme\^="claudette"\] \.markdown-body \.hr-ornament \{[^}]*border-top/)
    const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8')
    const families = [...html.matchAll(/family=([A-Za-z+0-9]+)/g)].map((m) => m[1]).sort()
    expect(families).toEqual(['Inter', 'JetBrains+Mono', 'Source+Serif+4'])
  })

  it('caps the text column at a reading measure', () => {
    // jsdom has no layout, so this checks the rule; the measured column is
    // 714px of text at any window width (42em at 17px).
    const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    const base = css.match(/\n\.markdown-body \{[^}]*\}/)![0]
    expect(base).toContain('max-width: min(70%, calc(42em + 4rem));')
  })

  it("lets the server's listing page follow the stored mode of any theme", () => {
    const server = readFileSync(path.resolve(__dirname, '../../src-tauri/src/server.rs'), 'utf8')
    const script = server.slice(server.indexOf('const ROOT_SCRIPT'), server.indexOf('"#;', server.indexOf('const ROOT_SCRIPT')))
    expect(script).toContain("localStorage.getItem('md-render-theme-mode')")
  })
})

describe('validateTheme', () => {
  const good = getTheme('claudette')!

  it('accepts a complete theme and drops unknown fields', () => {
    expect(validateTheme({ ...good, extra: 1 })).toEqual(good)
  })

  it('says what is wrong with a bad one', () => {
    expect(validateTheme(null)).toBe('not an object')
    expect(validateTheme({ ...good, id: 'Has Space' })).toMatch(/bad id/)
    expect(validateTheme({ ...good, mode: 'sepia' })).toMatch(/mode/)
    const vars: Record<string, string> = { ...good.vars }
    delete vars['--chart-8']
    expect(validateTheme({ ...good, vars })).toMatch(/missing --chart-8/)
  })
})

describe('getTheme', () => {
  it('resolves a known id, in the built-ins or a given registry', () => {
    expect(getTheme('claudette')?.id).toBe('claudette')
    const installed = { ...getTheme('claudette')!, id: 'latex' }
    expect(getTheme('latex')).toBeUndefined()
    expect(getTheme('latex', [...themes, installed])?.id).toBe('latex')
  })

  it('returns undefined for unknown or empty ids', () => {
    expect(getTheme('not-a-theme')).toBeUndefined()
    expect(getTheme(null)).toBeUndefined()
  })
})

describe('resolveTheme', () => {
  it('falls back to a light theme when no preference for dark', () => {
    expect(resolveTheme(null, false).id).toBe(DEFAULT_LIGHT)
  })

  it('falls back to a dark theme when the system prefers dark', () => {
    expect(resolveTheme(null, true).id).toBe(DEFAULT_DARK)
  })

  it('honours a valid stored id over the fallback', () => {
    expect(resolveTheme('claudette-dark', false).id).toBe('claudette-dark')
  })

  it('falls back for a theme that is not installed', () => {
    expect(resolveTheme('latex', false).id).toBe(DEFAULT_LIGHT)
  })
})
