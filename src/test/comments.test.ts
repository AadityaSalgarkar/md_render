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

  it('keeps the paragraph whole when the selection ends mid-sentence', () => {
    const result = insertCommentForSelection(
      'Intro line with a selectable passage of text for testing.\n\nSecond paragraph.',
      'a selectable pass',
      'Why?',
    )

    expect(result.content).toBe(
      'Intro line with a selectable passage of text for testing.\n'
        + '<chat><comment>Why?</comment></chat>\n'
        + '\nSecond paragraph.',
    )
  })

  it('lands after a hard-wrapped paragraph, not inside it', () => {
    const result = insertCommentForSelection(
      'Line one of the paragraph\nline two of the paragraph.\n\nNext.',
      'one of the',
      'Hm',
    )

    expect(result.content).toBe(
      'Line one of the paragraph\nline two of the paragraph.\n'
        + '<chat><comment>Hm</comment></chat>\n'
        + '\nNext.',
    )
  })

  it('appends at the end when the selection sits in the last block', () => {
    const result = insertCommentForSelection('Only line here', 'line', 'Note')

    expect(result.content).toBe('Only line here\n<chat><comment>Note</comment></chat>\n')
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
