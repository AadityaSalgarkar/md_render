import { describe, it, expect } from 'vitest'
import {
  themes,
  THEME_VARS,
  getTheme,
  resolveTheme,
  DEFAULT_LIGHT,
  DEFAULT_DARK,
} from '../lib/themes'

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

  it('gives every theme a valid mode and a three-colour swatch', () => {
    for (const theme of themes) {
      expect(['light', 'dark']).toContain(theme.mode)
      expect(theme.swatch).toHaveLength(3)
      expect(theme.name.length).toBeGreaterThan(0)
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
