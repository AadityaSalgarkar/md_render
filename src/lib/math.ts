/**
 * Make markdown written for MathJax render under KaTeX the way the blogs
 * that use MathJax show it.
 *
 * remark-math only knows `$…$` and `$$…$$`, and KaTeX has no equation
 * numbering, `\label` or `\eqref`. MathJax pages lean on all of these, so
 * before rendering:
 *
 * - `\(…\)` becomes `$…$` and `\[…\]` becomes `$$…$$`;
 * - a bare `\begin{equation}` / `align` / `gather` / `multline` /
 *   `eqnarray` block is wrapped in `$$…$$`;
 * - unstarred equation-like environments are numbered the AMS way — one
 *   number per equation, one per line of an align or gather, none for
 *   lines carrying `\nonumber` or `\notag` — by inserting `\tag{n}`;
 * - `\label{key}` is recorded and removed; `\eqref{key}` becomes `(n)`.
 *
 * Code fences and inline code are left untouched.
 */

const NUMBERED_ENVS = ['equation', 'align', 'gather', 'multline', 'eqnarray']
const ALL_ENVS = [...NUMBERED_ENVS, ...NUMBERED_ENVS.map((env) => `${env}*`)]

/** Split markdown into code (left alone) and prose (normalised) segments. */
function splitCode(source: string): Array<{ code: boolean; text: string }> {
  const segments: Array<{ code: boolean; text: string }> = []
  let index = 0
  let prose = ''
  const flush = () => {
    if (prose) segments.push({ code: false, text: prose })
    prose = ''
  }

  while (index < source.length) {
    // A fenced block starts a line with ``` or ~~~ and runs to the matching
    // closing fence (or the end of the document).
    const atLineStart = index === 0 || source[index - 1] === '\n'
    if (atLineStart) {
      const fence = /^( {0,3})(`{3,}|~{3,})/.exec(source.slice(index))
      if (fence) {
        const marker = fence[2]
        const closing = new RegExp(`\\n {0,3}${marker[0]}{${marker.length},}[ \\t]*(?=\\n|$)`)
        const rest = source.slice(index)
        const match = closing.exec(rest)
        const end = match ? index + match.index + match[0].length : source.length
        flush()
        segments.push({ code: true, text: source.slice(index, end) })
        index = end
        continue
      }
    }
    // An inline code span: a run of backticks closed by an equal run.
    if (source[index] === '`') {
      const run = /^`+/.exec(source.slice(index))![0]
      const close = source.indexOf(run, index + run.length)
      if (close >= 0) {
        flush()
        segments.push({ code: true, text: source.slice(index, close + run.length) })
        index = close + run.length
        continue
      }
    }
    prose += source[index]
    index += 1
  }
  flush()
  return segments
}

/**
 * A display block for remark-math: `$$` fences on lines of their own.
 * `$$x$$` on one line would be inline math, so line breaks are added where
 * the surrounding text does not already provide them.
 */
function displayBlock(prose: string, start: number, end: number, body: string): string {
  const lead = start === 0 || prose[start - 1] === '\n' ? '' : '\n'
  const tail = end >= prose.length || prose[end] === '\n' ? '' : '\n'
  return `${lead}$$\n${body.trim()}\n$$${tail}`
}

/** Replace MathJax's bracket delimiters with remark-math's dollar ones. */
function convertDelimiters(prose: string): string {
  const inline = prose.replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body}$`)
  let out = ''
  let last = 0
  for (const match of inline.matchAll(/\\\[([\s\S]*?)\\\]/g)) {
    const start = match.index!
    const end = start + match[0].length
    out += inline.slice(last, start) + displayBlock(inline, start, end, match[1])
    last = end
  }
  return out + inline.slice(last)
}

/** Wrap an equation-like environment that sits outside any `$$` in `$$`. */
function wrapBareEnvironments(prose: string): string {
  const envs = ALL_ENVS.map((env) => env.replace('*', '\\*')).join('|')
  const pattern = new RegExp(`\\\\begin\\{(${envs})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g')
  let out = ''
  let last = 0
  for (const match of prose.matchAll(pattern)) {
    const start = match.index!
    // Inside `$$ … $$` already if an odd number of `$$` precede it.
    const before = prose.slice(0, start)
    const open = (before.match(/\$\$/g) ?? []).length % 2 === 1
    if (open) continue
    const end = start + match[0].length
    out += prose.slice(last, start) + displayBlock(prose, start, end, match[0])
    last = end
  }
  return out + prose.slice(last)
}

/** Split an environment body on its top-level `\\` line breaks. */
function splitRows(body: string): string[] {
  const rows: string[] = []
  let depth = 0
  let braces = 0
  let current = ''
  let i = 0
  while (i < body.length) {
    const begin = /^\\begin\{[^}]*\}/.exec(body.slice(i))
    const end = /^\\end\{[^}]*\}/.exec(body.slice(i))
    if (begin) {
      depth += 1
      current += begin[0]
      i += begin[0].length
      continue
    }
    if (end) {
      depth -= 1
      current += end[0]
      i += end[0].length
      continue
    }
    if (body[i] === '{') braces += 1
    if (body[i] === '}') braces -= 1
    if (body.startsWith('\\\\', i) && depth === 0 && braces === 0) {
      rows.push(current)
      current = ''
      i += 2
      continue
    }
    current += body[i]
    i += 1
  }
  rows.push(current)
  return rows
}

interface Numbering {
  next: number
  labels: Map<string, number>
}

/** Number the rows of one environment body, collecting labels. */
function numberBody(env: string, body: string, numbering: Numbering): string {
  const perRow = env !== 'equation' && env !== 'multline'
  const rows = splitRows(body)
  const numbered = rows.map((row, rowIndex) => {
    // The trailing whitespace after the last row is not a row of its own.
    if (rowIndex === rows.length - 1 && row.trim() === '') return row
    if (!perRow && rowIndex > 0) return row
    let text = row
    let suppressed = /\\(nonumber|notag)\b/.test(text)
    if (/\\tag\b/.test(text)) suppressed = true
    let number: number | null = null
    if (!suppressed) {
      number = numbering.next
      numbering.next += 1
    }
    text = text.replace(/[ \t]*\\label\{([^}]*)\}/g, (_, key: string) => {
      if (number !== null) numbering.labels.set(key, number)
      return ''
    })
    if (number !== null) {
      // The tag goes before any trailing whitespace so KaTeX sees it on the row.
      text = text.replace(/\s*$/, (ws) => ` \\tag{${number}}${ws}`)
    }
    return text
  })
  return numbered.join('\\\\')
}

/** Add AMS numbers to the unstarred environments inside `$$` blocks. */
function numberEnvironments(prose: string, numbering: Numbering): string {
  const envs = NUMBERED_ENVS.join('|')
  const pattern = new RegExp(`\\\\begin\\{(${envs})\\}([\\s\\S]*?)\\\\end\\{\\1\\}`, 'g')
  return prose.replace(pattern, (_, env: string, body: string) => {
    return `\\begin{${env}}${numberBody(env, body, numbering)}\\end{${env}}`
  })
}

/** Turn every `\eqref{key}` into the number it refers to. */
function resolveReferences(prose: string, labels: Map<string, number>): string {
  return prose.replace(/\\(?:eqref|ref)\{([^}]*)\}/g, (_, key: string) => {
    const number = labels.get(key)
    return number === undefined ? '(?)' : `(${number})`
  })
}

/** Drop the labels KaTeX cannot parse that sit on unnumbered rows. */
function stripLabels(prose: string): string {
  return prose.replace(/[ \t]*\\label\{[^}]*\}/g, '')
}

export function normalizeMath(source: string): string {
  if (!/\\[[(]|\\begin\{|\\label|\\eqref|\\ref\{/.test(source)) return source

  const segments = splitCode(source)
  const numbering: Numbering = { next: 1, labels: new Map() }

  // Two passes: numbers and labels first, so a reference can point forward.
  const prepared = segments.map((segment) => {
    if (segment.code) return segment.text
    let prose = convertDelimiters(segment.text)
    prose = wrapBareEnvironments(prose)
    prose = numberEnvironments(prose, numbering)
    return stripLabels(prose)
  })

  return segments
    .map((segment, i) =>
      segment.code ? prepared[i] : resolveReferences(prepared[i], numbering.labels),
    )
    .join('')
}
