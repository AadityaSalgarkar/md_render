import { describe, expect, it } from 'vitest'
import {
  insertCommentForSelection,
  parseChatThreads,
  stripCommentThreads,
} from '../lib/comments'

describe('comment markdown helpers', () => {
  it('inserts a comment chat block after selected text', () => {
    const result = insertCommentForSelection(
      'Intro paragraph.\n\nSecond paragraph.',
      'Intro paragraph.',
      'Please expand this point.',
    )

    expect(result.inserted).toBe(true)
    expect(result.content).toContain(
      'Intro paragraph.\n<chat><comment>Please expand this point.</comment></chat>',
    )
  })

  it('escapes comment content before writing it into markdown', () => {
    const result = insertCommentForSelection('Text', 'Text', 'Use <tag> & explain')

    expect(result.content).toContain(
      '<comment>Use &lt;tag&gt; &amp; explain</comment>',
    )
  })

  it('parses comments and LLM responses from chat blocks', () => {
    const threads = parseChatThreads(`Text
<chat><comment>Question?</comment><response>Answer.</response></chat>`)

    expect(threads).toHaveLength(1)
    expect(threads[0].comment).toBe('Question?')
    expect(threads[0].responses).toEqual(['Answer.'])
  })

  it('strips chat blocks from clean exported markdown', () => {
    const clean = stripCommentThreads(`A
<chat><comment>Remove me</comment><response>And me</response></chat>

B`)

    expect(clean).toBe('A\n\nB')
  })
})
