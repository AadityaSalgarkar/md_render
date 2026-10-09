/**
 * Chart colours from the active theme's CSS variables: eight series hues
 * (`--chart-1` .. `--chart-8`) plus text, grid and fonts. Groups take a hue;
 * members of a group take shades of it.
 */

import type { DashStyle } from './schema'

export interface Palette {
  series: string[]
  text: string
  muted: string
  grid: string
  surface: string
  font: string
  mono: string
  mode: 'light' | 'dark'
}

/** Warm Paper's values, used when a variable is missing (tests, first paint). */
export const FALLBACK_SERIES = [
  '#C9553D', '#2D5A4A', '#5A7A9A', '#B07D48', '#8959A8', '#6B8E4E', '#A23B5E', '#7A7A7A',
]

export const CHART_VARS = Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`)

export function readPalette(root: HTMLElement = document.documentElement): Palette {
  const style = getComputedStyle(root)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    series: CHART_VARS.map((name, i) => read(name, FALLBACK_SERIES[i])),
    text: read('--text-secondary', '#5C5C5C'),
    muted: read('--text-muted', '#8A8A8A'),
    grid: read('--border', '#E8E2D9'),
    surface: read('--bg-secondary', '#F5F1EA'),
    font: read('--font-body', 'Georgia, serif'),
    mono: read('--font-mono', 'monospace'),
    mode: root.dataset.mode === 'dark' ? 'dark' : 'light',
  }
}

/** Parse #rgb, #rrggbb or rgb()/rgba() into [r, g, b, a]. */
export function parseColor(color: string): [number, number, number, number] | null {
  const text = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)).concat(1) as [number, number, number, number]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1]
    }
  }
  return null
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hslString(h: number, s: number, l: number, a = 1): string {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const body = `${Math.round(h)} ${Math.round(clamp(s) * 100)}% ${Math.round(clamp(l) * 100)}%`
  return a < 1 ? `hsl(${body} / ${a})` : `hsl(${body})`
}

/**
 * Shade `index` of `count` around a base colour: lightness spreads by up to
 * 0.36 in total, darker first, so members of a group read as one family.
 */
export function shade(base: string, index: number, count: number): string {
  if (count <= 1) return base
  const parsed = parseColor(base)
  if (!parsed) return base
  const [h, s, l] = toHsl(parsed[0], parsed[1], parsed[2])
  const spread = Math.min(0.36, 0.12 * (count - 1))
  const offset = -spread / 2 + (spread * index) / (count - 1)
  return hslString(h, s * (1 - 0.1 * Math.abs(offset) / 0.18), l + offset)
}

/** The same colour at a given opacity. */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color)
  if (!parsed) return color
  return `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${alpha})`
}

/** Hue for a group: cycles the eight theme colours. */
export function groupColor(palette: Palette, groupIndex: number): string {
  return palette.series[groupIndex % palette.series.length]
}

/** Canvas dash patterns, by style and by index. */
export const DASH_PATTERNS: Record<DashStyle, number[]> = {
  solid: [],
  dashed: [6, 4],
  dotted: [2, 3],
  'dash-dot': [8, 3, 2, 3],
}
export const DASH_ORDER: DashStyle[] = ['solid', 'dashed', 'dotted', 'dash-dot']

export function dashFor(index: number): DashStyle {
  return DASH_ORDER[index % DASH_ORDER.length]
}
