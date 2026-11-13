import { describe, expect, it } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { Preview } from '../components/Preview'
import { useState } from 'react'
import { blankQuizResponses, prepareQuizBlocks, readQuizResponses, writeQuizResponse } from '../lib/quiz'

const QUIZ_DOC = `# Study Sheet

Some prose before.

<quiz>Which planet is **largest**?
<enumerate>
<option>Mars</option>
<option>Jupiter</option>
</enumerate>
</quiz>

Prose after.
`

function article(): ReturnType<typeof within> {
  const el = document.querySelector('article.markdown-body')
  expect(el).not.toBeNull()
  return within(el as HTMLElement)
}

describe('prepareQuizBlocks', () => {
  it('renames tags only inside quiz regions', () => {
    const input = '<option>outside</option>\n<quiz>q<enumerate><option>a</option></enumerate></quiz>'
    const output = prepareQuizBlocks(input)

    expect(output).toContain('<option>outside</option>')
    expect(output).toContain('<md-quiz>')
    expect(output).toContain('<md-enumerate><md-option>a</md-option></md-enumerate>')
    expect(output).not.toContain('<quiz>')
  })

  it('handles several quiz blocks and multiline content', () => {
    const input = '<quiz>one\n<enumerate>\n<option>a</option>\n</enumerate>\n</quiz>\n\ntext\n\n<quiz>two<enumerate><option>b</option></enumerate></quiz>'
    const output = prepareQuizBlocks(input)

    expect(output.match(/<md-quiz>/g)).toHaveLength(2)
    expect(output.match(/<md-option>/g)).toHaveLength(2)
    expect(output).toContain('text')
  })

  it('leaves documents without quizzes untouched', () => {
    const input = '# plain\n\n<enumerate>not a quiz</enumerate>'
    expect(prepareQuizBlocks(input)).toBe(input)
  })
})

describe('quiz rendering', () => {
  it('shows the question but hides the options by default', async () => {
    render(<Preview content={QUIZ_DOC} tocOpen={false} />)
    await article().findByText(/Which planet is/)

    // The question renders, with its markdown processed.
    expect(article().getByText('largest')).toBeInTheDocument()
    // The options are not in the DOM at all.
    expect(article().queryByText('Mars')).toBeNull()
    expect(article().queryByText('Jupiter')).toBeNull()
    // A count row says what is hidden.
    expect(article().getByText('2 options hidden')).toBeInTheDocument()
  })

  it('reveals the options with the eye button and hides them again', async () => {
    render(<Preview content={QUIZ_DOC} tocOpen={false} />)
    await article().findByText(/Which planet is/)

    const eye = article().getByRole('button', { name: 'Reveal options' })
    expect(eye).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(eye)
    expect(article().getByText('Mars')).toBeInTheDocument()
    expect(article().getByText('Jupiter')).toBeInTheDocument()
    expect(eye).toHaveAttribute('aria-expanded', 'true')
    expect(eye).toHaveAccessibleName('Hide options')

    fireEvent.click(eye)
    expect(article().queryByText('Mars')).toBeNull()
  })

  it('reveals via the hidden-count row too', async () => {
    render(<Preview content={QUIZ_DOC} tocOpen={false} />)
    await article().findByText(/Which planet is/)

    fireEvent.click(article().getByText('2 options hidden'))
    expect(article().getByText('Jupiter')).toBeInTheDocument()
  })

  it('keeps several quizzes independent', async () => {
    const two = `${QUIZ_DOC}\n<quiz>Second question?\n<enumerate>\n<option>Yes</option>\n</enumerate>\n</quiz>\n`
    render(<Preview content={two} tocOpen={false} />)
    await article().findByText('Second question?')

    const eyes = article().getAllByRole('button', { name: 'Reveal options' })
    expect(eyes).toHaveLength(2)

    fireEvent.click(eyes[1])
    expect(article().getByText('Yes')).toBeInTheDocument()
    // The first quiz stays hidden.
    expect(article().queryByText('Mars')).toBeNull()
  })

  it('hides the answer until explicitly opened, independent of the options', async () => {
    const doc = `<quiz>Question?
<enumerate>
<option>A</option>
</enumerate>
<answer>Because **reasons**.</answer>
</quiz>
`
    render(<Preview content={doc} tocOpen={false} />)
    await article().findByText('Question?')

    // Hidden by default.
    expect(article().queryByText(/reasons/)).toBeNull()
    const show = article().getByRole('button', { name: 'Show answer' })
    expect(show).toHaveAttribute('aria-expanded', 'false')

    // Revealing the options does NOT reveal the answer.
    fireEvent.click(article().getByRole('button', { name: 'Reveal options' }))
    expect(article().queryByText(/reasons/)).toBeNull()

    // Explicit click opens it, with the markdown inside rendered.
    fireEvent.click(show)
    expect(article().getByText('reasons')).toBeInTheDocument()

    // And it closes again.
    fireEvent.click(article().getByRole('button', { name: 'Hide answer' }))
    expect(article().queryByText(/reasons/)).toBeNull()
  })

  it('works standalone outside any quiz', async () => {
    render(
      <Preview
        content={'A worked example.\n\n<answer>The answer is 42.</answer>\n'}
        tocOpen={false}
      />,
    )
    await article().findByText('A worked example.')

    expect(article().queryByText(/42/)).toBeNull()
    fireEvent.click(article().getByRole('button', { name: 'Show answer' }))
    expect(article().getByText(/42/)).toBeInTheDocument()
  })

  it('does not disturb an <option> outside any quiz', async () => {
    render(
      <Preview
        content={'before\n\n<select><option>plain select</option></select>\n'}
        tocOpen={false}
      />,
    )
    await article().findByText('before')

    // Renders as a native option, not a quiz item; nothing crashes.
    expect(article().queryByText(/options hidden/)).toBeNull()
    expect(document.querySelector('.quiz-card')).toBeNull()
  })
})

describe('quiz responses in the markdown', () => {
  const doc = `<quiz>Why?
<response>first answer</response>
</quiz>

<chat><comment>c</comment><response>a chat reply, not a quiz answer</response></chat>

<quiz>And?
<response></response>
<answer>Because.</answer>
</quiz>
`

  it('reads every quiz response in order, ignoring <response> outside quizzes', () => {
    expect(readQuizResponses(doc)).toEqual(['first answer', ''])
  })

  it('writes one response and leaves the rest of the document alone', () => {
    const next = writeQuizResponse(doc, 1, 'my own words')
    expect(next).not.toBeNull()
    expect(readQuizResponses(next!)).toEqual(['first answer', 'my own words'])
    expect(next).toContain('<response>a chat reply, not a quiz answer</response>')
    expect(next!.replace('my own words', '')).toBe(doc)
  })

  it('answers null for a response that does not exist', () => {
    expect(writeQuizResponse(doc, 2, 'x')).toBeNull()
  })

  it('round-trips text that would otherwise close the tags early', () => {
    const tricky = 'line one\n\nline two </response> and </quiz> and <b>x</b>'
    const next = writeQuizResponse(doc, 0, tricky)!
    expect(readQuizResponses(next)).toEqual([tricky, ''])
    // The quiz still has its own end, so the second quiz is still found.
    expect(next.match(/<\/quiz>/g)).toHaveLength(2)
  })

  it('blanks response text before the markdown is parsed', () => {
    const blanked = blankQuizResponses(doc)
    expect(blanked).not.toContain('first answer')
    expect(blanked).toContain('<md-response data-index="0"></md-response>')
    expect(blanked).toContain('<md-response data-index="1"></md-response>')
  })
})

/** A document whose quiz answers save into its own text, as the app does. */
function Harness({ initial, onChange }: { initial: string; onChange?: (next: string) => void }) {
  const [content, setContent] = useState(initial)
  const save = async (index: number, text: string) => {
    const next = writeQuizResponse(content, index, text)
    if (next === null) throw new Error('no such response')
    setContent(next)
    onChange?.(next)
  }
  return <Preview content={content} tocOpen={false} onQuizResponse={save} />
}

describe('quiz response box', () => {
  const doc = `<quiz>Explain overfitting.
<response></response>
<answer>The model memorises noise.</answer>
</quiz>
`

  it('saves the written answer into the document', async () => {
    let saved = ''
    render(<Harness initial={doc} onChange={(next) => (saved = next)} />)
    const box = await article().findByRole('textbox', { name: 'Your answer' })
    const button = article().getByRole('button', { name: 'Save answer' })
    expect(button).toBeDisabled()

    fireEvent.change(box, { target: { value: 'It fits the training set too closely.\n\nIt generalises badly.' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    await article().findByText('Saved to the document')
    expect(saved).toContain('<response>It fits the training set too closely.\n\nIt generalises badly.</response>')
    // The rest of the quiz still renders around it.
    expect(article().getByRole('button', { name: 'Show answer' })).toBeInTheDocument()
    expect(article().getByRole('button', { name: 'Save answer' })).toBeDisabled()
  })

  it('saves with Cmd/Ctrl+Enter', async () => {
    let saved = ''
    render(<Harness initial={doc} onChange={(next) => (saved = next)} />)
    const box = await article().findByRole('textbox', { name: 'Your answer' })
    fireEvent.change(box, { target: { value: 'quick' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await article().findByText('Saved to the document')
    expect(saved).toContain('<response>quick</response>')
  })

  it('shows a saved answer, even one with blank lines and markup, without breaking the page', async () => {
    const answered = writeQuizResponse(doc, 0, 'para one\n\n<plot>{"bad": json}</plot>\n\n$x^2$')!
    render(<Preview content={answered} tocOpen={false} />)
    const box = await article().findByRole('textbox', { name: 'Your answer' })
    expect(box).toHaveValue('para one\n\n<plot>{"bad": json}</plot>\n\n$x^2$')
    expect(article().getByRole('button', { name: 'Show answer' })).toBeInTheDocument()
    expect(document.querySelector('[class^="experiment-plot"]')).toBeNull()
  })

  it('says so where answers cannot be saved', async () => {
    render(<Preview content={doc} tocOpen={false} />)
    await article().findByRole('textbox', { name: 'Your answer' })
    expect(article().getByText('Answers cannot be saved here')).toBeInTheDocument()
    expect(article().queryByRole('button', { name: 'Save answer' })).toBeNull()
  })

  it('follows the document when the answer changes underneath an untouched box', async () => {
    const { rerender } = render(<Preview content={doc} tocOpen={false} />)
    const box = await article().findByRole('textbox', { name: 'Your answer' })
    expect(box).toHaveValue('')
    rerender(<Preview content={writeQuizResponse(doc, 0, 'written by an agent')!} tocOpen={false} />)
    expect(article().getByRole('textbox', { name: 'Your answer' })).toHaveValue('written by an agent')
  })
})
