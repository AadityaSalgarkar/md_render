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
