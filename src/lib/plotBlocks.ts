/**
 * Plot blocks are authored as a tag or a fence holding JSON:
 *
 *   <plot>
 *   { "plot_type": "line", "source": { "project": "demo" } }
 *   </plot>
 *
 *   ```plot
 *   { "plot_type": "line", "source": { "project": "demo" } }
 *   ```
 *
 * Before markdown is parsed, both become a fence with the internal language
 * `md-plot`, so blank lines inside the JSON cannot end an HTML block, math
 * normalisation leaves the body alone (it skips fences), and the renderer
 * receives the JSON verbatim. A `<plot>` inside another fence (an example in
 * the docs) is left as written.
 */

export const PLOT_LANGUAGE = 'md-plot'

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/
const PLOT_INFO = /^\s*(?:language-)?plot\s*$/i

/** Rewrite plot tags and plot fences to `md-plot` fences. */
export function preparePlotBlocks(markdown: string): string {
  return rewriteTagBlocks(markdown, 'plot', PLOT_INFO, PLOT_LANGUAGE)
}

/**
 * Rewrite `<TAG>…</TAG>` blocks, and fences whose info string matches
 * `info`, into fences of `language`. Fences of any other language are
 * skipped whole, so an example inside a code block stays as written. A tag
 * without its closing tag is left alone.
 */
export function rewriteTagBlocks(markdown: string, tag: string, info: RegExp, language: string): string {
  if (!markdown.includes(tag)) return markdown
  const openTag = new RegExp(`^\\s{0,3}<${tag}>(.*)$`)
  const closeTag = `</${tag}>`
  const lines = markdown.split('\n')
  const out: string[] = []
  let fence: { marker: string; length: number } | null = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (fence) {
      out.push(line)
      const close = new RegExp(`^ {0,3}${fence.marker[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
      if (close.test(line)) fence = null
      continue
    }

    const open = FENCE_OPEN.exec(line)
    if (open) {
      const marker = open[2]
      if (info.test(open[3])) {
        out.push(`${open[1]}${marker}${language}`)
      } else {
        out.push(line)
      }
      fence = { marker, length: marker.length }
      continue
    }

    const opened = openTag.exec(line)
    if (opened) {
      // Collect up to the closing tag; without one the line stays as written.
      const body: string[] = []
      let rest = opened[1]
      let closed = false
      let after = ''
      let j = i
      for (;;) {
        const end = rest.indexOf(closeTag)
        if (end >= 0) {
          body.push(rest.slice(0, end))
          after = rest.slice(end + closeTag.length)
          closed = true
          break
        }
        body.push(rest)
        j += 1
        if (j >= lines.length) break
        rest = lines[j]
      }
      if (!closed) {
        out.push(line)
        continue
      }
      const longest = Math.max(2, ...body.join('\n').match(/`+/g)?.map((m) => m.length) ?? [0])
      const ticks = '`'.repeat(longest + 1)
      out.push(`${ticks}${language}`, body.join('\n').trim(), ticks)
      if (after.trim()) out.push(after)
      i = j
      continue
    }

    out.push(line)
  }
  return out.join('\n')
}

/** Whether a code element's class names mark a plot block. */
export function isPlotLanguage(className?: string): boolean {
  return (className ?? '')
    .split(/\s+/)
    .some((token) => token === PLOT_LANGUAGE || token === `language-${PLOT_LANGUAGE}`)
}
