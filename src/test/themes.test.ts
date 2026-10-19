import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  themes,
  themeSwatch,
  THEME_VARS,
  getTheme,
  resolveTheme,
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
  it('registers at least five themes', () => {
    expect(themes.length).toBeGreaterThanOrEqual(5)
  })

  it('gives every theme a unique id', () => {
    const ids = themes.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('defines every required CSS variable for every theme', () => {
    for (const theme of themes) {
      for (const name of THEME_VARS) {
        expect(theme.vars[name], `${theme.id} is missing ${name}`).toBeTruthy()
      }
    }
  })

  it('gives every theme a valid mode and a swatch of page, text and accent', () => {
    for (const theme of themes) {
      expect(['light', 'dark']).toContain(theme.mode)
      expect(themeSwatch(theme)).toEqual([
        theme.vars['--bg-primary'],
        theme.vars['--text-primary'],
        theme.vars['--accent'],
      ])
      expect(theme.name.length).toBeGreaterThan(0)
    }
  })

  it('keeps body text readable: at least 4.5:1 against the page in every theme', () => {
    for (const theme of themes) {
      const ratio = contrast(theme.vars['--text-primary'], theme.vars['--bg-primary'])
      expect(ratio, `${theme.id}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('pairs each Typora-inspired theme with a dark variant of the same name and fonts', () => {
    for (const id of ['claude', 'sonnet', 'claudette', 'latex']) {
      const light = getTheme(id)!
      const dark = getTheme(`${id}-dark`)!
      expect(light.mode).toBe('light')
      expect(dark.mode).toBe('dark')
      expect(dark.name).toBe(light.name)
      for (const font of ['--font-head', '--font-body', '--font-mono'] as const) {
        expect(dark.vars[font]).toBe(light.vars[font])
      }
    }
  })

  it('sets the LaTeX theme in the bundled New Computer Modern, display math on the page', () => {
    for (const id of ['latex', 'latex-dark']) {
      const latex = getTheme(id)!
      expect(latex.vars['--font-body']).toMatch(/^"MDR New Computer Modern"/)
      expect(latex.vars['--font-mono']).toMatch(/^"MDR New Computer Modern Mono"/)
      expect(latex.vars['--math-display-bg']).toBe('transparent')
    }
  })

  it('does not load the Claude theme fonts, which are not licensed for redistribution', () => {
    for (const theme of themes) {
      for (const font of ['--font-head', '--font-body', '--font-mono'] as const) {
        expect(theme.vars[font]).not.toMatch(/Anthropic/)
      }
    }
  })

  it('caps the text column at a reading measure in every theme', () => {
    // jsdom has no layout, so this checks the rule; the measured column is
    // 714px of text at any window width (42em at 17px).
    const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    const base = css.match(/\n\.markdown-body \{[^}]*\}/)![0]
    expect(base).toContain('max-width: min(70%, calc(42em + 4rem));')
    // No theme widens it again; LaTeX alone narrows it.
    const widened = [...css.matchAll(/\[data-theme[^\]]*\][^{]*\.markdown-body \{[^}]*max-width:[^;]*;/g)].map((m) => m[0])
    expect(widened).toHaveLength(1)
    expect(widened[0]).toContain('[data-theme^="latex"]')
  })

  it("lets the server's listing page tell every dark theme apart", () => {
    // ROOT_SCRIPT in server.rs names the older dark themes and matches `-dark`.
    const server = readFileSync(path.resolve(__dirname, '../../src-tauri/src/server.rs'), 'utf8')
    const script = server.slice(server.indexOf('const ROOT_SCRIPT'), server.indexOf('"#;', server.indexOf('const ROOT_SCRIPT')))
    for (const theme of themes.filter((t) => t.mode === 'dark')) {
      const covered = theme.id.endsWith('-dark') || script.includes(`'${theme.id}'`)
      expect(covered, `${theme.id} would show the listing in light mode`).toBe(true)
    }
    for (const theme of themes.filter((t) => t.mode === 'light')) {
      expect(theme.id.endsWith('-dark') || script.includes(`'${theme.id}'`), theme.id).toBe(false)
    }
  })

  it('includes both light and dark themes', () => {
    expect(themes.some((t) => t.mode === 'light')).toBe(true)
    expect(themes.some((t) => t.mode === 'dark')).toBe(true)
  })

  it('has the plain sans-serif theme with its site colours', () => {
    const plain = getTheme('plain')!
    expect(plain.mode).toBe('light')
    expect(plain.vars['--bg-primary']).toBe('#FFFFFF')
    expect(plain.vars['--accent']).toBe('#22558E')
    expect(plain.vars['--font-body']).toMatch(/^Helvetica/)
    // No serif face anywhere: the whole point of the theme.
    expect(plain.vars['--font-head']).not.toMatch(/serif"|Georgia/)
  })

  it('has the ponder theme with its violet accent and code face', () => {
    const ponder = getTheme('ponder')!
    expect(ponder.mode).toBe('light')
    expect(ponder.vars['--accent']).toBe('#8E7BD0')
    expect(ponder.vars['--font-mono']).toMatch(/^"Google Sans Code"/)
    expect(ponder.vars['--font-body']).toMatch(/^-apple-system/)
  })

  it('has the paradigm theme with its stone ground, teal text and mono heads', () => {
    const paradigm = getTheme('paradigm')!
    expect(paradigm.mode).toBe('light')
    expect(paradigm.vars['--bg-primary']).toBe('#E9E5DA')
    expect(paradigm.vars['--accent']).toBe('#436F7A')
    expect(paradigm.vars['--text-primary']).toBe('#3C646E')
    expect(paradigm.vars['--font-body']).toMatch(/^"Literata"/)
    expect(paradigm.vars['--font-mono']).toMatch(/^"Geist Mono"/)
    // Display math sits on the page, as on the site.
    expect(paradigm.vars['--math-display-bg']).toBe('transparent')
  })
})

describe('getTheme', () => {
  it('resolves a known id', () => {
    expect(getTheme('warm-paper')?.id).toBe('warm-paper')
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
    expect(resolveTheme('nocturne', false).id).toBe('nocturne')
  })

  it('ignores an invalid stored id', () => {
    expect(resolveTheme('garbage', false).id).toBe(DEFAULT_LIGHT)
  })
})
