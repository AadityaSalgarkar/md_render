/**
 * Theme registry — the single source of truth for every visual theme.
 *
 * A theme is just a bag of CSS custom properties. `useTheme` applies one by
 * setting `<html data-theme="...">` and writing each var via `style.setProperty`.
 * `src/index.css` keeps the Warm Paper values on `:root` as the default so the
 * very first paint is never unstyled.
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
] as const

export type ThemeVar = (typeof THEME_VARS)[number]

export interface ThemeDefinition {
  id: string
  name: string
  mode: ThemeMode
  /** One-line personality summary shown in the picker. */
  blurb: string
  /** Three representative colors for the picker swatch. */
  swatch: [string, string, string]
  vars: Record<ThemeVar, string>
}

const SERIF_HEAD = '"Playfair Display", Georgia, serif'
const SERIF_BODY = '"Source Serif 4", Georgia, serif'
const PLEX_MONO = '"IBM Plex Mono", "Fira Code", monospace'
const JB_MONO = '"JetBrains Mono", "Fira Code", monospace'

export const themes: ThemeDefinition[] = [
  {
    id: 'warm-paper',
    name: 'Warm Paper',
    mode: 'light',
    blurb: 'Premium book typography on aged cream stock.',
    swatch: ['#FAF7F2', '#C9553D', '#2D5A4A'],
    vars: {
      '--bg-primary': '#FAF7F2',
      '--bg-secondary': '#F5F1EA',
      '--bg-editor': '#FFFDF8',
      '--bg-preview': '#FAF7F2',
      '--text-primary': '#1A1A1A',
      '--text-secondary': '#5C5C5C',
      '--text-muted': '#8A8A8A',
      '--accent': '#C9553D',
      '--accent-hover': '#B84A34',
      '--accent-secondary': '#2D5A4A',
      '--border': '#E8E2D9',
      '--border-strong': '#D4CCC0',
      '--code-bg': '#F0EDE6',
      '--selection': 'rgba(201, 85, 61, 0.15)',
      '--shadow-fold': '8px 0 24px -8px rgba(0, 0, 0, 0.12)',
      '--font-head': SERIF_HEAD,
      '--font-body': SERIF_BODY,
      '--font-mono': PLEX_MONO,
      '--code-keyword': '#C9553D',
      '--code-string': '#2D5A4A',
      '--code-number': '#B07D48',
      '--code-comment': '#8A8A8A',
      '--code-function': '#5A7A9A',
      '--code-builtin': '#8959A8',
    },
  },
  {
    id: 'midnight-ink',
    name: 'Midnight Ink',
    mode: 'dark',
    blurb: 'Warm ink glow against a deep blue-black night.',
    swatch: ['#121418', '#E07A5F', '#81B29A'],
    vars: {
      '--bg-primary': '#121418',
      '--bg-secondary': '#1A1D23',
      '--bg-editor': '#0D0F12',
      '--bg-preview': '#121418',
      '--text-primary': '#E8E4DC',
      '--text-secondary': '#9A968E',
      '--text-muted': '#6A665E',
      '--accent': '#E07A5F',
      '--accent-hover': '#E8907A',
      '--accent-secondary': '#81B29A',
      '--border': '#2A2D35',
      '--border-strong': '#3A3D45',
      '--code-bg': '#1A1D23',
      '--selection': 'rgba(224, 122, 95, 0.2)',
      '--shadow-fold': '8px 0 24px -8px rgba(0, 0, 0, 0.5)',
      '--font-head': SERIF_HEAD,
      '--font-body': SERIF_BODY,
      '--font-mono': PLEX_MONO,
      '--code-keyword': '#E07A5F',
      '--code-string': '#81B29A',
      '--code-number': '#D4A656',
      '--code-comment': '#6A665E',
      '--code-function': '#7FA8C9',
      '--code-builtin': '#B77FDB',
    },
  },
  {
    id: 'newsprint',
    name: 'Newsprint',
    mode: 'light',
    blurb: 'High-contrast editorial broadsheet, set in red and ink.',
    swatch: ['#F4F2EC', '#A8281E', '#16130E'],
    vars: {
      '--bg-primary': '#F4F2EC',
      '--bg-secondary': '#EBE8DF',
      '--bg-editor': '#FBFAF6',
      '--bg-preview': '#F4F2EC',
      '--text-primary': '#16130E',
      '--text-secondary': '#4A4640',
      '--text-muted': '#847E72',
      '--accent': '#A8281E',
      '--accent-hover': '#8E1F17',
      '--accent-secondary': '#2B2622',
      '--border': '#D6D1C4',
      '--border-strong': '#A8A290',
      '--code-bg': '#EAE7DC',
      '--selection': 'rgba(168, 40, 30, 0.14)',
      '--shadow-fold': '8px 0 24px -8px rgba(0, 0, 0, 0.16)',
      '--font-head': SERIF_HEAD,
      '--font-body': '"Spectral", Georgia, serif',
      '--font-mono': PLEX_MONO,
      '--code-keyword': '#A8281E',
      '--code-string': '#3C5A2E',
      '--code-number': '#8A5A1E',
      '--code-comment': '#847E72',
      '--code-function': '#2A4C6E',
      '--code-builtin': '#6E3A6E',
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    mode: 'dark',
    blurb: 'Phosphor-green CRT glow, monospaced from edge to edge.',
    swatch: ['#0A0E0A', '#4AF626', '#FFB000'],
    vars: {
      '--bg-primary': '#0A0E0A',
      '--bg-secondary': '#0F150F',
      '--bg-editor': '#070A07',
      '--bg-preview': '#0A0E0A',
      '--text-primary': '#4AF626',
      '--text-secondary': '#2EA319',
      '--text-muted': '#1C6610',
      '--accent': '#FFB000',
      '--accent-hover': '#FFC740',
      '--accent-secondary': '#3FD9D9',
      '--border': '#143810',
      '--border-strong': '#1F5417',
      '--code-bg': '#0F150F',
      '--selection': 'rgba(74, 246, 38, 0.22)',
      '--shadow-fold': '8px 0 24px -8px rgba(0, 0, 0, 0.7)',
      '--font-head': JB_MONO,
      '--font-body': JB_MONO,
      '--font-mono': JB_MONO,
      '--code-keyword': '#FFB000',
      '--code-string': '#3FD9D9',
      '--code-number': '#E0E04A',
      '--code-comment': '#1C6610',
      '--code-function': '#5AF0FF',
      '--code-builtin': '#FF6AC1',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'light',
    blurb: 'Moss and bark on a sun-warmed sage page.',
    swatch: ['#EDEBDD', '#5C7A4A', '#B05E2E'],
    vars: {
      '--bg-primary': '#EDEBDD',
      '--bg-secondary': '#E3E0CE',
      '--bg-editor': '#F5F3E8',
      '--bg-preview': '#EDEBDD',
      '--text-primary': '#232B1F',
      '--text-secondary': '#4F5A45',
      '--text-muted': '#7E8870',
      '--accent': '#5C7A4A',
      '--accent-hover': '#4C6A3C',
      '--accent-secondary': '#B05E2E',
      '--border': '#D2CFBB',
      '--border-strong': '#B4B098',
      '--code-bg': '#E4E1CF',
      '--selection': 'rgba(92, 122, 74, 0.16)',
      '--shadow-fold': '8px 0 24px -8px rgba(40, 50, 30, 0.18)',
      '--font-head': '"Fraunces", Georgia, serif',
      '--font-body': '"EB Garamond", Georgia, serif',
      '--font-mono': JB_MONO,
      '--code-keyword': '#5C7A4A',
      '--code-string': '#B05E2E',
      '--code-number': '#8A6A1E',
      '--code-comment': '#7E8870',
      '--code-function': '#3E6A5E',
      '--code-builtin': '#7A4A7A',
    },
  },
]

export const DEFAULT_LIGHT = 'warm-paper'
export const DEFAULT_DARK = 'midnight-ink'

const themesById = new Map(themes.map((t) => [t.id, t]))

/** Look up a theme by id; returns undefined for unknown ids. */
export function getTheme(id: string | null | undefined): ThemeDefinition | undefined {
  return id ? themesById.get(id) : undefined
}

/** Resolve a stored/preference id to a real theme, with a sensible fallback. */
export function resolveTheme(id: string | null | undefined, prefersDark: boolean): ThemeDefinition {
  return getTheme(id) ?? getTheme(prefersDark ? DEFAULT_DARK : DEFAULT_LIGHT)!
}
