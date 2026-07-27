import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Preview } from '../components/Preview'

// jsdom does not load index.css, so visibility assertions need the one rule
// the feature's CSS contract relies on. Keeping it here also pins the
// selector: if the class names drift from the stylesheet, these tests break.
beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = '.md-section.is-collapsed > .md-section-body { display: none; }'
  document.head.appendChild(style)
})

const DOC = `intro before any heading

# Title

opening paragraph

## Alpha

alpha body text

### Alpha child

alpha child text

## Beta

beta body text
`

/** Scope queries to the rendered article, away from the index sidebar. */
function article(): ReturnType<typeof within> {
  const el = document.querySelector('article.markdown-body')
  expect(el).not.toBeNull()
  return within(el as HTMLElement)
}

/** The collapse toggle rendered inside the heading with the given text. */
function toggleOf(heading: string): HTMLElement {
  const el = article().getByText(heading).closest('h1, h2, h3, h4')!
  const button = el.querySelector('button.section-toggle')
  expect(button).not.toBeNull()
  return button as HTMLElement
}

describe('collapsible sections', () => {
  it('wraps headings and their content into nested sections', async () => {
    const { container } = render(<Preview content={DOC} tocOpen={false} />)

    await waitFor(() => {
      expect(container.querySelectorAll('section.md-section').length).toBe(4)
    })

    // The h3 section nests inside the h2 section's body.
    const alpha = container.querySelector('section[data-heading-id="alpha"]')!
    expect(alpha.querySelector('section[data-heading-id="alpha-child"]')).not.toBeNull()

    // Content before the first heading stays outside any section.
    const intro = article().getByText('intro before any heading')
    expect(intro.closest('section.md-section')).toBeNull()
  })

  it('collapses a section body with the arrow and restores it', async () => {
    render(<Preview content={DOC} tocOpen={false} />)
    await article().findByText('alpha body text')

    const toggle = toggleOf('Alpha')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(article().getByText('alpha body text')).not.toBeVisible()
    // The heading itself stays visible; siblings are untouched.
    expect(article().getByText('Alpha')).toBeVisible()
    expect(article().getByText('beta body text')).toBeVisible()

    fireEvent.click(toggle)
    expect(article().getByText('alpha body text')).toBeVisible()
  })

  it('collapsing a parent hides subsections; their own state survives', async () => {
    render(<Preview content={DOC} tocOpen={false} />)
    await article().findByText('alpha child text')

    // Collapse the child, then the parent.
    fireEvent.click(toggleOf('Alpha child'))
    fireEvent.click(toggleOf('Alpha'))
    expect(article().getByText('Alpha child')).not.toBeVisible()

    // Re-open the parent: the child section is visible again but still
    // collapsed, exactly as it was left.
    fireEvent.click(toggleOf('Alpha'))
    expect(article().getByText('Alpha child')).toBeVisible()
    expect(toggleOf('Alpha child')).toHaveAttribute('aria-expanded', 'false')
    expect(article().getByText('alpha child text')).not.toBeVisible()
  })

  it('shows the ellipsis chip while collapsed, and it expands on click', async () => {
    render(<Preview content={DOC} tocOpen={false} />)
    await article().findByText('beta body text')

    fireEvent.click(toggleOf('Beta'))
    const chip = article().getByText('⋯')
    expect(article().getByText('beta body text')).not.toBeVisible()

    fireEvent.click(chip)
    expect(article().getByText('beta body text')).toBeVisible()
    expect(article().queryByText('⋯')).toBeNull()
  })

  it('keeps collapse state across a content refresh of the same document', async () => {
    const { rerender } = render(
      <Preview content={DOC} tocOpen={false} documentKey="/tmp/a.md" />,
    )
    await article().findByText('alpha body text')
    fireEvent.click(toggleOf('Alpha'))

    // The 30-second sync re-renders with (possibly identical) content.
    rerender(
      <Preview content={DOC + '\nmore\n'} tocOpen={false} documentKey="/tmp/a.md" />,
    )
    await article().findByText('more')
    expect(article().getByText('alpha body text')).not.toBeVisible()
  })

  it('resets collapse state when a different document opens', async () => {
    const { rerender } = render(
      <Preview content={DOC} tocOpen={false} documentKey="/tmp/a.md" />,
    )
    await article().findByText('alpha body text')
    fireEvent.click(toggleOf('Alpha'))
    expect(article().getByText('alpha body text')).not.toBeVisible()

    rerender(<Preview content={DOC} tocOpen={false} documentKey="/tmp/b.md" />)
    await waitFor(() => {
      expect(article().getByText('alpha body text')).toBeVisible()
    })
  })

  it('navigating from the index into a collapsed section auto-expands it', async () => {
    render(<Preview content={DOC} tocOpen={true} documentKey="/tmp/a.md" />)
    await article().findByText('alpha child text')

    fireEvent.click(toggleOf('Alpha'))
    expect(article().getByText('Alpha child')).not.toBeVisible()

    // The index lists the child heading; navigating there must reveal it.
    const indexEntry = screen
      .getAllByRole('button')
      .find((b) => b.classList.contains('toc-link') && b.textContent?.includes('Alpha child'))!
    fireEvent.click(indexEntry)

    expect(article().getByText('Alpha child')).toBeVisible()
    // The child's own body was never collapsed, so it shows too.
    expect(article().getByText('alpha child text')).toBeVisible()
  })

  it('does not offer collapsing for headings inside blockquotes', async () => {
    const { container } = render(
      <Preview content={'> ## Quoted heading\n> quoted text\n'} tocOpen={false} />,
    )
    await article().findByText('Quoted heading')

    expect(container.querySelector('section.md-section')).toBeNull()
    expect(container.querySelector('button.section-toggle')).toBeNull()
  })

  it('collapses sections made from raw HTML headings too', async () => {
    render(
      <Preview
        content={'<h2>Raw heading</h2>\n\nraw body text\n'}
        tocOpen={false}
      />,
    )
    await article().findByText('raw body text')

    fireEvent.click(toggleOf('Raw heading'))
    expect(article().getByText('raw body text')).not.toBeVisible()
  })
})
