import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Preview } from '../components/Preview'

describe('Preview', () => {
  it('renders markdown headings', () => {
    render(<Preview content="# Hello World" tocOpen={false} />)
    expect(screen.getByRole('heading', { name: 'Hello World' })).toBeInTheDocument()
  })

  it('renders bold text', () => {
    render(<Preview content="**bold text**" tocOpen={false} />)
    const strong = screen.getByText('bold text')
    expect(strong.tagName.toLowerCase()).toBe('strong')
  })

  it('renders italic text', () => {
    render(<Preview content="*italic text*" tocOpen={false} />)
    const em = screen.getByText('italic text')
    expect(em.tagName.toLowerCase()).toBe('em')
  })

  it('renders links', () => {
    render(<Preview content="[Link](https://example.com)" tocOpen={false} />)
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('renders unordered lists', () => {
    const content = `- Item 1
- Item 2
- Item 3`
    render(<Preview content={content} tocOpen={false} />)
    expect(screen.getByText('Item 1')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    expect(screen.getByText('Item 3')).toBeInTheDocument()
  })

  it('renders ordered lists', () => {
    const content = `1. First
2. Second
3. Third`
    render(<Preview content={content} tocOpen={false} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('renders code blocks', () => {
    const content = `\`\`\`javascript
const x = 1;
\`\`\``
    render(<Preview content={content} tocOpen={false} />)
    // Syntax highlighting breaks text into spans, so check for code element with class
    const codeElement = document.querySelector('code.hljs')
    expect(codeElement).toBeInTheDocument()
    expect(codeElement?.textContent).toContain('const')
  })

  it('renders inline code', () => {
    render(<Preview content="Use `inline code` here" tocOpen={false} />)
    const code = screen.getByText('inline code')
    expect(code.tagName.toLowerCase()).toBe('code')
  })

  it('renders blockquotes', () => {
    render(<Preview content="> This is a quote" tocOpen={false} />)
    const blockquote = screen.getByText('This is a quote').closest('blockquote')
    expect(blockquote).toBeInTheDocument()
  })

  it('renders GFM tables', () => {
    const tableMarkdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`
    render(<Preview content={tableMarkdown} tocOpen={false} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Header 1')).toBeInTheDocument()
    expect(screen.getByText('Cell 1')).toBeInTheDocument()
  })

  it('renders GFM strikethrough', () => {
    render(<Preview content="~~strikethrough~~" tocOpen={false} />)
    const del = screen.getByText('strikethrough')
    expect(del.tagName.toLowerCase()).toBe('del')
  })

  it('renders GFM task lists', () => {
    const content = `- [x] Done
- [ ] Todo`
    render(<Preview content={content} tocOpen={false} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
  })

  it('has copy button on code blocks', () => {
    const content = `\`\`\`js
code
\`\`\``
    render(<Preview content={content} tocOpen={false} />)
    const copyButton = screen.getByRole('button', { name: /copy/i })
    expect(copyButton).toBeInTheDocument()
  })

  it('renders inline math', () => {
    render(<Preview content="The equation $E = mc^2$ is famous." tocOpen={false} />)
    const katexSpan = document.querySelector('.katex')
    expect(katexSpan).toBeInTheDocument()
  })

  it('renders block math', () => {
    const content = `$$
\\frac{1}{2}
$$`
    render(<Preview content={content} tocOpen={false} />)
    const katexDisplay = document.querySelector('.katex-display')
    expect(katexDisplay).toBeInTheDocument()
  })

  it('renders math with other content', () => {
    const content = `# Math Section

Here is inline $x^2$ math.

$$
\\sum_{i=1}^n i = \\frac{n(n+1)}{2}
$$

And some **bold** text.`
    render(<Preview content={content} tocOpen={false} />)
    expect(screen.getByRole('heading', { name: 'Math Section' })).toBeInTheDocument()
    expect(document.querySelector('.katex')).toBeInTheDocument()
    expect(document.querySelector('.katex-display')).toBeInTheDocument()
    expect(screen.getByText('bold')).toBeInTheDocument()
  })

  it('gives headings slug ids so the index can link to them', () => {
    const content = `# Hello World

## Nested Section`
    render(<Preview content={content} tocOpen={false} />)
    expect(screen.getByRole('heading', { name: 'Hello World' })).toHaveAttribute(
      'id',
      'hello-world',
    )
    expect(screen.getByRole('heading', { name: 'Nested Section' })).toHaveAttribute(
      'id',
      'nested-section',
    )
  })

  it('builds a document index from headings when the sidebar is open', () => {
    const content = `# Title One

## Section Two`
    render(<Preview content={content} tocOpen />)
    const index = screen.getByRole('complementary', { name: /document index/i })
    expect(index).toBeInTheDocument()
    // Heading text appears both in the article and the index.
    expect(screen.getAllByText('Title One').length).toBeGreaterThan(1)
  })
})
