/**
 * Quiz blocks are authored with friendly tag names:
 *
 *   <quiz>Which planet is largest?
 *   <enumerate>
 *   <option>Mars</option>
 *   <option>Jupiter</option>
 *   </enumerate>
 *   </quiz>
 *
 * But `<option>` is not a neutral tag — the HTML parser applies form
 * content-model rules to it and hoists the options out of `<enumerate>`,
 * leaving the quiz empty. Dash-named custom elements carry no such rules, so
 * before rendering we rewrite the tags inside quiz regions to parser-safe
 * internals that the Quiz components register for:
 *
 *   quiz → md-quiz, enumerate → md-enumerate, option → md-option
 *
 * Only regions between <quiz> and </quiz> are touched; an <option> anywhere
 * else in a document stays exactly as written. Lowercase tags only, matching
 * the <chat> comment convention.
 */

const QUIZ_REGION = /<quiz>([\s\S]*?)<\/quiz>/g

const RENAMES: Array<[RegExp, string]> = [
  [/<enumerate>/g, '<md-enumerate>'],
  [/<\/enumerate>/g, '</md-enumerate>'],
  [/<option>/g, '<md-option>'],
  [/<\/option>/g, '</md-option>'],
]

/**
 * A `<response>` inside a quiz is the reader's written answer. Its text lives
 * only in the markdown file: the renderer never parses it (an answer may hold
 * blank lines, `<`, math or a stray `<plot>`), it gets an indexed placeholder
 * and reads the text through `readQuizResponses`.
 */
const RESPONSE = /<response>([\s\S]*?)<\/response>/g

/** Closing tags that would end the response or the quiz early when written verbatim. */
const CLOSERS: Array<[string, string]> = [
  ['</response>', '&lt;/response>'],
  ['</quiz>', '&lt;/quiz>'],
]

function encodeResponse(text: string): string {
  return CLOSERS.reduce((out, [raw, safe]) => out.split(raw).join(safe), text)
}

function decodeResponse(stored: string): string {
  return CLOSERS.reduce((out, [raw, safe]) => out.split(safe).join(raw), stored).trim()
}

/** Call `visit` on every quiz response in document order; returns the rewritten markdown. */
function mapResponses(markdown: string, visit: (stored: string, index: number) => string): string {
  let index = 0
  return markdown.replace(QUIZ_REGION, (region: string) =>
    region.replace(RESPONSE, (_match, stored: string) => visit(stored, index++)),
  )
}

/** The reader's written answers, one per quiz `<response>`, in document order. */
export function readQuizResponses(markdown: string): string[] {
  const out: string[] = []
  mapResponses(markdown, (stored) => {
    out.push(decodeResponse(stored))
    return stored
  })
  return out
}

/** The markdown with the `index`th quiz response set to `text`, or null when there is no such response. */
export function writeQuizResponse(markdown: string, index: number, text: string): string | null {
  let found = false
  const next = mapResponses(markdown, (stored, i) => {
    if (i !== index) return `<response>${stored}</response>`
    found = true
    return `<response>${encodeResponse(text.trim())}</response>`
  })
  return found ? next : null
}

/**
 * Replace each quiz response with an empty placeholder carrying its index.
 * Run on the raw markdown, before the other block preparers, so answer text is
 * gone before anything else reads the document.
 */
export function blankQuizResponses(markdown: string): string {
  return mapResponses(markdown, (_stored, index) => `<md-response data-index="${index}"></md-response>`)
}

/** Rewrite quiz regions to the internal tag names the renderer understands. */
export function prepareQuizBlocks(markdown: string): string {
  return markdown.replace(QUIZ_REGION, (_match, body: string) => {
    let inner = body
    for (const [from, to] of RENAMES) {
      inner = inner.replace(from, to)
    }
    return `<md-quiz>${inner}</md-quiz>`
  })
}
