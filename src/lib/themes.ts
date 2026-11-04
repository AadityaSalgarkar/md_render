/**
 * Theme registry. Claudette and Claudette Dark are built in; every other
 * theme is a package in ./themes that users install at runtime (see
 * themes/README.md), and `useTheme` adds installed ones to this list.
 *
 * A theme is a bag of CSS custom properties. `useTheme` applies one by
 * setting `<html data-theme="...">` and writing each var via `style.setProperty`.
 * `src/index.css` keeps the Claudette values on `:root` so the very first
 * paint is never unstyled.
 */

export type ThemeMode = 'light' | 'dark'

/** Every CSS custom property a theme must define. */
export const THEME_VARS = [
  // Surfaces
  '--bg-primary',
  '--bg-secondary',
  '--bg-editor',
  '--bg-preview',
  // Text
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  // Accents
  '--accent',
  '--accent-hover',
  '--accent-secondary',
  // Lines & code surface
  '--border',
  '--border-strong',
  '--code-bg',
  '--selection',
  '--shadow-fold',
  // Display math: the book themes set it in a tinted panel; the bare
  // web-page themes leave it on the page, as MathJax does.
  '--math-display-bg',
  '--math-display-padding',
  // Typography
  '--font-head',
  '--font-body',
  '--font-mono',
  // Syntax highlighting
  '--code-keyword',
  '--code-string',
  '--code-number',
  '--code-comment',
  '--code-function',
  '--code-builtin',
  // Plot series hues, in the order groups take them
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
] as const

export type ThemeVar = (typeof THEME_VARS)[number]

export interface ThemeDefinition {
  id: string
  name: string
  mode: ThemeMode
  /** One-line personality summary shown in the picker. */
  blurb: string
  vars: Record<ThemeVar, string>
}

/** The theme's main colours, as the picker shows them: page, text, accent. */
export function themeSwatch(theme: ThemeDefinition): [string, string, string] {
  return [theme.vars['--bg-primary'], theme.vars['--text-primary'], theme.vars['--accent']]
}

const CLAUDETTE_SERIF = '"Source Serif 4", "Source Serif Pro", Charter, Georgia, "Noto Serif SC", serif'
const CLAUDETTE_MONO = '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace'

/** The themes compiled into the app; installed packages add to these. */
export const themes: ThemeDefinition[] = [
  {
    id: 'claudette',
    name: 'Claudette',
    mode: 'light',
    blurb: 'A white sheet on ivory: Source Serif, hairline code, one clay accent.',
    vars: {
      '--bg-primary': '#FAF9F5',
      '--bg-secondary': '#F2F0E9',
      '--bg-editor': '#FFFFFF',
      '--bg-preview': '#FAF9F5',
      '--text-primary': '#141413',
      '--text-secondary': '#52514E',
      '--text-muted': '#73726C',
      '--accent': '#C6613F',
      '--accent-hover': '#D97757',
      '--accent-secondary': '#9C4A21',
      '--border': '#E3E1D7',
      '--border-strong': '#D1CFC5',
      '--code-bg': '#F5F4ED',
      '--selection': 'rgba(217, 119, 87, 0.18)',
      '--shadow-fold': '8px 0 24px -8px rgba(20, 20, 19, 0.1)',
      '--math-display-bg': 'transparent',
      '--math-display-padding': '0.4rem 0',
      '--font-head': CLAUDETTE_SERIF,
      '--font-body': CLAUDETTE_SERIF,
      '--font-mono': CLAUDETTE_MONO,
      '--code-keyword': '#C2452D',
      '--code-string': '#9C4A21',
      '--code-number': '#9A6700',
      '--code-comment': '#6E7781',
      '--code-function': '#6F42C1',
      '--code-builtin': '#1F6FE5',
      '--chart-1': '#D97757',
      '--chart-2': '#1F6FE5',
      '--chart-3': '#6F42C1',
      '--chart-4': '#9A6700',
      '--chart-5': '#2E7D5B',
      '--chart-6': '#C2452D',
      '--chart-7': '#52514E',
      '--chart-8': '#87867F',
    },
  },
  {
    id: 'claudette-dark',
    name: 'Claudette',
    mode: 'dark',
    blurb: 'The same sheet after dark: warm greys and one clay accent.',
    vars: {
      '--bg-primary': '#262625',
      '--bg-secondary': '#2C2C2A',
      '--bg-editor': '#1A1A19',
      '--bg-preview': '#262625',
      '--text-primary': '#F2F0E9',
      '--text-secondary': '#D6D3C8',
      '--text-muted': '#9C9A90',
      '--accent': '#E6906F',
      '--accent-hover': '#F0A88C',
      '--accent-secondary': '#E5B07E',
      '--border': '#3A3933',
      '--border-strong': '#4A4943',
      '--code-bg': '#34332E',
      '--selection': 'rgba(217, 119, 87, 0.28)',
      '--shadow-fold': '8px 0 24px -8px rgba(0, 0, 0, 0.45)',
      '--math-display-bg': 'transparent',
      '--math-display-padding': '0.4rem 0',
      '--font-head': CLAUDETTE_SERIF,
      '--font-body': CLAUDETTE_SERIF,
      '--font-mono': CLAUDETTE_MONO,
      '--code-keyword': '#FF8D77',
      '--code-string': '#E5B07E',
      '--code-number': '#E3C07B',
      '--code-comment': '#8B8B81',
      '--code-function': '#C8A6FF',
      '--code-builtin': '#8FB8FF',
      '--chart-1': '#E6906F',
      '--chart-2': '#8FB8FF',
      '--chart-3': '#C8A6FF',
      '--chart-4': '#E3C07B',
      '--chart-5': '#7FC8A0',
      '--chart-6': '#FF8D77',
      '--chart-7': '#D6D3C8',
      '--chart-8': '#9C9A90',
    },
  },
]

export const DEFAULT_LIGHT = 'claudette'
export const DEFAULT_DARK = 'claudette-dark'

/** Look up a theme by id; returns undefined for unknown ids. */
export function getTheme(
  id: string | null | undefined,
  registry: ThemeDefinition[] = themes,
): ThemeDefinition | undefined {
  return id ? registry.find((t) => t.id === id) : undefined
}

/** Resolve a stored/preference id to a real theme, with a sensible fallback. */
export function resolveTheme(
  id: string | null | undefined,
  prefersDark: boolean,
  registry: ThemeDefinition[] = themes,
): ThemeDefinition {
  return getTheme(id, registry) ?? getTheme(prefersDark ? DEFAULT_DARK : DEFAULT_LIGHT)!
}

/** An installed theme package: its themes and whether it has a theme.css. */
export interface ThemePackage {
  package: string
  themes: ThemeDefinition[]
  css: boolean
}

/** Ids are lower-case words joined by hyphens: they go into CSS selectors and URLs. */
export const THEME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Check one entry of a package's theme.json. Returns the theme, or why it is
 * unusable, so a bad package is skipped rather than breaking the picker.
 */
export function validateTheme(raw: unknown): ThemeDefinition | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const t = raw as Record<string, unknown>
  if (typeof t.id !== 'string' || !THEME_ID.test(t.id)) return `bad id ${JSON.stringify(t.id)}`
  if (typeof t.name !== 'string' || !t.name.trim()) return `${t.id}: missing name`
  if (t.mode !== 'light' && t.mode !== 'dark') return `${t.id}: mode must be "light" or "dark"`
  if (typeof t.vars !== 'object' || t.vars === null) return `${t.id}: missing vars`
  const vars = t.vars as Record<string, unknown>
  const missing = THEME_VARS.filter((name) => typeof vars[name] !== 'string' || !(vars[name] as string).trim())
  if (missing.length) return `${t.id}: missing ${missing.join(', ')}`
  return {
    id: t.id,
    name: t.name,
    mode: t.mode,
    blurb: typeof t.blurb === 'string' ? t.blurb : '',
    vars: Object.fromEntries(THEME_VARS.map((name) => [name, vars[name] as string])) as Record<ThemeVar, string>,
  }
}
