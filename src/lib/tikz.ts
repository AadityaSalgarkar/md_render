/**
 * TikZ blocks: authored as a ```tikz fence or a <tikz> tag, compiled to SVG
 * by the backend (Tectonic, see src-tauri/src/tikz.rs), shown inline.
 *
 * Header lines are TeX comments, so a block stays valid LaTeX:
 *
 *   %! packages: pgfplots, tikz-cd
 *   %! libraries: arrows.meta, positioning
 *   %! preamble: \newcommand{\R}{\mathbb{R}}
 *   %! caption: What the figure shows.
 *
 * The backend reads the first three; the caption is shown by the page.
 */

import { rewriteTagBlocks } from './plotBlocks'

export const TIKZ_LANGUAGE = 'tikz'
const TIKZ_INFO = /^\s*(?:language-)?tikz\s*$/i

/** Rewrite `<tikz>…</tikz>` to a ```tikz fence before markdown parsing. */
export function prepareTikzBlocks(markdown: string): string {
  return rewriteTagBlocks(markdown, 'tikz', TIKZ_INFO, TIKZ_LANGUAGE)
}

/** Whether a code element's class names mark a TikZ block. */
export function isTikzLanguage(className?: string): boolean {
  return (className ?? '')
    .toLowerCase()
    .split(/\s+/)
    .some((token) => token === 'tikz' || token === 'language-tikz')
}

/** The `%! caption:` line of a block, if any. */
export function tikzCaption(source: string): string {
  for (const line of source.split('\n')) {
    const match = /^\s*%!\s*caption\s*:(.*)$/i.exec(line)
    if (match) return match[1].trim()
  }
  return ''
}

export interface TikzRendered {
  key: string
  svg: string
  cached: boolean
}

export type TikzErrorCode = 'tex' | 'timeout' | 'too_large' | 'engine' | 'io' | 'unavailable'

export class TikzError extends Error {
  code: TikzErrorCode
  log: string[]

  constructor(code: TikzErrorCode, message: string, log: string[] = []) {
    super(message)
    this.name = 'TikzError'
    this.code = code
    this.log = log
  }

  /** From whatever the backend rejected with: the JSON error or plain text. */
  static from(raw: unknown, fallback = 'the diagram could not be rendered'): TikzError {
    if (raw instanceof TikzError) return raw
    let value = raw
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw)
      } catch {
        return new TikzError('engine', raw || fallback)
      }
    }
    if (value && typeof value === 'object' && 'error' in value && 'message' in value) {
      const body = value as { error: TikzErrorCode; message: string; log?: string[] }
      return new TikzError(body.error, body.message, body.log ?? [])
    }
    if (value instanceof Error) return new TikzError('engine', value.message)
    return new TikzError('engine', fallback)
  }
}

export interface TikzApi {
  render(source: string): Promise<TikzRendered>
}

/** The server's /api/tikz route. Compiling needs the page token. */
export function serverTikz(base: string, token: () => string): TikzApi {
  return {
    render: async (source) => {
      let response: Response
      try {
        response = await fetch(`${base}/api/tikz`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ source }),
        })
      } catch (err) {
        throw new TikzError('unavailable', `could not reach the server: ${String(err)}`)
      }
      const text = await response.text()
      if (!response.ok) throw TikzError.from(text, `request failed (${response.status})`)
      return JSON.parse(text) as TikzRendered
    },
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Elements an SVG from the compiler may contain; anything else is dropped. */
const ALLOWED = new Set([
  'svg', 'g', 'defs', 'path', 'use', 'symbol', 'clippath', 'mask', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'image',
  'title', 'desc', 'text', 'tspan',
])

/** Pure white as the compiler writes it. */
const WHITE = new Set(['#ffffff', '#fff', 'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)'])

/** TeX points to CSS pixels. */
const PT_TO_PX = 4 / 3

/**
 * Keep only drawing elements and safe attributes, and size the drawing in
 * CSS pixels (the compiler measures in TeX points). Returns markup ready to
 * inline, or null when the input is not an SVG.
 */
export function sanitizeSvg(markup: string): string | null {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') return null

  const walk = (element: Element) => {
    for (const child of Array.from(element.children)) {
      if (!ALLOWED.has(child.localName.toLowerCase())) {
        child.remove()
        continue
      }
      for (const attribute of Array.from(child.attributes)) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value.trim().toLowerCase()
        const isLink = name === 'href' || name === 'xlink:href'
        if (
          name.startsWith('on') ||
          (isLink && !value.startsWith('#') && !(child.localName === 'image' && value.startsWith('data:image/')))
        ) {
          child.removeAttribute(attribute.name)
        }
      }
      // White paper (a legend box, a node fill) takes the figure background,
      // so light text on it stays readable in dark themes.
      for (const paint of ['fill', 'stroke']) {
        const value = child.getAttribute(paint)
        if (value && WHITE.has(value.trim().toLowerCase())) {
          child.removeAttribute(paint)
          child.setAttribute('style', `${child.getAttribute('style') ?? ''};${paint}:var(--tikz-paper, #fff)`)
        }
      }
      walk(child)
    }
  }
  for (const attribute of Array.from(root.attributes)) {
    if (attribute.name.toLowerCase().startsWith('on')) root.removeAttribute(attribute.name)
  }
  walk(root)

  for (const dimension of ['width', 'height']) {
    const value = Number.parseFloat(root.getAttribute(dimension) ?? '')
    if (Number.isFinite(value) && value > 0) root.setAttribute(dimension, `${Math.round(value * PT_TO_PX * 100) / 100}`)
  }
  root.setAttribute('role', 'img')
  return new XMLSerializer().serializeToString(root)
}
