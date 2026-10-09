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
  if (!markdown.includes('plot')) return markdown
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
      if (PLOT_INFO.test(open[3])) {
        out.push(`${open[1]}${marker}${PLOT_LANGUAGE}`)
      } else {
        out.push(line)
      }
      fence = { marker, length: marker.length }
      continue
    }

    const tag = /^\s{0,3}<plot>(.*)$/.exec(line)
    if (tag) {
      // Collect up to the closing tag; without one the line stays as written.
      const body: string[] = []
      let rest = tag[1]
      let closed = false
      let after = ''
      let j = i
      for (;;) {
        const end = rest.indexOf('</plot>')
        if (end >= 0) {
          body.push(rest.slice(0, end))
          after = rest.slice(end + '</plot>'.length)
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
      out.push(`${ticks}${PLOT_LANGUAGE}`, body.join('\n').trim(), ticks)
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
