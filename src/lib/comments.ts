export interface ChatThread {
  id: string
  comment: string
  responses: string[]
  raw: string
}

export interface InsertCommentResult {
  content: string
  inserted: boolean
}

const CHAT_BLOCK_RE = /<chat\b[^>]*>([\s\S]*?)<\/chat>/gi
const COMMENT_RE = /<comment\b[^>]*>([\s\S]*?)<\/comment>/gi
const RESPONSE_RE = /<response\b[^>]*>([\s\S]*?)<\/response>/gi

export function parseChatThreads(content: string): ChatThread[] {
  const threads: ChatThread[] = []
  for (const match of content.matchAll(CHAT_BLOCK_RE)) {
    const raw = match[0]
    const inner = match[1] ?? ''
    const comments = Array.from(inner.matchAll(COMMENT_RE), (commentMatch) =>
      decodeEntities(commentMatch[1]?.trim() ?? ''),
    ).filter(Boolean)
    const taggedResponses = Array.from(inner.matchAll(RESPONSE_RE), (responseMatch) =>
      decodeEntities(responseMatch[1]?.trim() ?? ''),
    ).filter(Boolean)
    const residualResponse = decodeEntities(
      inner
        .replace(COMMENT_RE, '')
        .replace(RESPONSE_RE, '')
        .trim(),
    )
    const responses = residualResponse
      ? [...taggedResponses, residualResponse]
      : taggedResponses

    threads.push({
      id: `chat-${match.index ?? threads.length}`,
      comment: comments.join('\n\n'),
      responses,
      raw,
    })
  }
  return threads
}

export function insertCommentForSelection(
  content: string,
  selectedText: string,
  comment: string,
): InsertCommentResult {
  const selection = selectedText.trim()
  const trimmedComment = comment.trim()
  if (!selection || !trimmedComment) {
    return { content, inserted: false }
  }

  const range = findSelectionRange(content, selection)
  const block = `\n<chat><comment>${escapeEntities(trimmedComment)}</comment></chat>\n`

  if (!range) {
    const targetNote = `\n\n> Comment target: ${selection}\n`
    return {
      content: `${content.replace(/\s*$/, '')}${targetNote}${block}`,
      inserted: true,
    }
  }

  // Land after the block (paragraph, list, …) holding the end of the
  // selection, never inside it: a block split mid-sentence renders as two
  // paragraphs, both on disk and on screen.
  const at = blockEnd(content, range.end)
  // The blank line that ends the block already supplies the trailing newline.
  const inserted = content.startsWith('\n', at) ? block.slice(0, -1) : block
  const nextContent = `${content.slice(0, at)}${inserted}${content.slice(at)}`
  return { content: nextContent, inserted: true }
}

export function stripCommentThreads(content: string): string {
  return content
    .replace(CHAT_BLOCK_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

function findSelectionRange(content: string, selection: string): { start: number; end: number } | null {
  const exactIndex = content.indexOf(selection)
  if (exactIndex >= 0) {
    return { start: exactIndex, end: exactIndex + selection.length }
  }

  const singleLineSelection = selection.replace(/\s+/g, ' ')
  if (singleLineSelection !== selection) {
    const singleLineIndex = content.indexOf(singleLineSelection)
    if (singleLineIndex >= 0) {
      return { start: singleLineIndex, end: singleLineIndex + singleLineSelection.length }
    }
  }

  return null
}

function escapeEntities(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Offset of the first blank line at or after `from`, else the end of text. */
function blockEnd(content: string, from: number): number {
  const blank = /\n[ \t]*\n/g
  blank.lastIndex = from
  const found = blank.exec(content)
  return found ? found.index : content.length
}
