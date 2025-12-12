import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Preview } from '../components/Preview'

describe('Preview', () => {
  it('renders markdown headings', () => {
    render(<Preview content="# Hello World" />)
    expect(screen.getByRole('heading', { name: 'Hello World' })).toBeInTheDocument()
  })

  it('renders bold text', () => {
    render(<Preview content="**bold text**" />)
    const strong = screen.getByText('bold text')
    expect(strong.tagName.toLowerCase()).toBe('strong')
  })

  it('renders italic text', () => {
    render(<Preview content="*italic text*" />)
    const em = screen.getByText('italic text')
    expect(em.tagName.toLowerCase()).toBe('em')
  })

  it('renders links', () => {
    render(<Preview content="[Link](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('renders unordered lists', () => {
    const content = `- Item 1
- Item 2
- Item 3`
    render(<Preview content={content} />)
    expect(screen.getByText('Item 1')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    expect(screen.getByText('Item 3')).toBeInTheDocument()
  })

  it('renders ordered lists', () => {
    const content = `1. First
2. Second
3. Third`
    render(<Preview content={content} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('renders code blocks', () => {
    const content = `\`\`\`javascript
const x = 1;
\`\`\``
    render(<Preview content={content} />)
    // Syntax highlighting breaks text into spans, so check for code element with class
    const codeElement = document.querySelector('code.hljs')
    expect(codeElement).toBeInTheDocument()
    expect(codeElement?.textContent).toContain('const')
  })

  it('renders inline code', () => {
    render(<Preview content="Use `inline code` here" />)
    const code = screen.getByText('inline code')
    expect(code.tagName.toLowerCase()).toBe('code')
  })

  it('renders blockquotes', () => {
    render(<Preview content="> This is a quote" />)
    const blockquote = screen.getByText('This is a quote').closest('blockquote')
    expect(blockquote).toBeInTheDocument()
  })

  it('renders GFM tables', () => {
    const tableMarkdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`
    render(<Preview content={tableMarkdown} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Header 1')).toBeInTheDocument()
    expect(screen.getByText('Cell 1')).toBeInTheDocument()
  })

  it('renders GFM strikethrough', () => {
    render(<Preview content="~~strikethrough~~" />)
    const del = screen.getByText('strikethrough')
    expect(del.tagName.toLowerCase()).toBe('del')
  })

  it('renders GFM task lists', () => {
    const content = `- [x] Done
- [ ] Todo`
    render(<Preview content={content} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
  })

  it('has copy button on code blocks', () => {
    const content = `\`\`\`js
code
\`\`\``
    render(<Preview content={content} />)
    const copyButton = screen.getByRole('button', { name: /copy/i })
    expect(copyButton).toBeInTheDocument()
  })

  it('renders inline math', () => {
    render(<Preview content="The equation $E = mc^2$ is famous." />)
    const katexSpan = document.querySelector('.katex')
    expect(katexSpan).toBeInTheDocument()
  })

  it('renders block math', () => {
    const content = `$$
\\frac{1}{2}
$$`
    render(<Preview content={content} />)
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
    render(<Preview content={content} />)
    expect(screen.getByRole('heading', { name: 'Math Section' })).toBeInTheDocument()
    expect(document.querySelector('.katex')).toBeInTheDocument()
    expect(document.querySelector('.katex-display')).toBeInTheDocument()
    expect(screen.getByText('bold')).toBeInTheDocument()
  })
})
