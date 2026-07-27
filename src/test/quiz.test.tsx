import { describe, expect, it } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { Preview } from '../components/Preview'
import { prepareQuizBlocks } from '../lib/quiz'

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
