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
  {
    id: 'nocturne',
    name: 'Nocturne',
    mode: 'dark',
    blurb: 'Muted dusk — soft iris and foam adrift on plum shadow.',
    swatch: ['#191724', '#C4A7E7', '#9CCFD8'],
    vars: {
      '--bg-primary': '#191724',
      '--bg-secondary': '#1F1D2E',
      '--bg-editor': '#13111E',
      '--bg-preview': '#191724',
      '--text-primary': '#E0DEF4',
      '--text-secondary': '#908CAA',
      '--text-muted': '#6E6A86',
      '--accent': '#C4A7E7',
      '--accent-hover': '#D2BBEF',
      '--accent-secondary': '#9CCFD8',
      '--border': '#2A2837',
      '--border-strong': '#3D3A52',
      '--code-bg': '#1F1D2E',
      '--selection': 'rgba(196, 167, 231, 0.22)',
      '--shadow-fold': '8px 0 24px -8px rgba(0, 0, 0, 0.55)',
      '--font-head': SERIF_HEAD,
      '--font-body': '"Spectral", Georgia, serif',
      '--font-mono': PLEX_MONO,
      '--code-keyword': '#C4A7E7',
      '--code-string': '#F6C177',
      '--code-number': '#EBBCBA',
      '--code-comment': '#6E6A86',
      '--code-function': '#9CCFD8',
      '--code-builtin': '#EB6F92',
    },
  },
  {
    id: 'evergreen',
    name: 'Evergreen',
    mode: 'dark',
    blurb: 'A forest after dark — moss and amber under a pine canopy.',
    swatch: ['#14201A', '#8FB36B', '#D89A5B'],
    vars: {
      '--bg-primary': '#14201A',
      '--bg-secondary': '#1B2A22',
      '--bg-editor': '#0F1813',
      '--bg-preview': '#14201A',
      '--text-primary': '#DCE5D8',
      '--text-secondary': '#97A691',
      '--text-muted': '#647060',
      '--accent': '#8FB36B',
      '--accent-hover': '#A3C57F',
      '--accent-secondary': '#D89A5B',
      '--border': '#2A3A30',
      '--border-strong': '#3A4D40',
      '--code-bg': '#1B2A22',
      '--selection': 'rgba(143, 179, 107, 0.2)',
      '--shadow-fold': '8px 0 24px -8px rgba(0, 0, 0, 0.6)',
      '--font-head': '"Fraunces", Georgia, serif',
      '--font-body': '"EB Garamond", Georgia, serif',
      '--font-mono': JB_MONO,
      '--code-keyword': '#8FB36B',
      '--code-string': '#D89A5B',
      '--code-number': '#C9B458',
      '--code-comment': '#647060',
      '--code-function': '#6FB3A0',
      '--code-builtin': '#C57F5B',
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
