import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TableOfContents } from '../components/TableOfContents'
import type { Heading } from '../types'

const headings: Heading[] = [
  { id: 'intro', text: 'Introduction', level: 1 },
  { id: 'usage', text: 'Usage', level: 2 },
  { id: 'api', text: 'API Reference', level: 2 },
]

describe('TableOfContents', () => {
  it('renders an entry for every heading', () => {
    render(
      <TableOfContents headings={headings} activeId={null} open onNavigate={() => {}} />,
    )
    expect(screen.getByText('Introduction')).toBeInTheDocument()
    expect(screen.getByText('Usage')).toBeInTheDocument()
    expect(screen.getByText('API Reference')).toBeInTheDocument()
  })

  it('shows an empty state when there are no headings', () => {
    render(<TableOfContents headings={[]} activeId={null} open onNavigate={() => {}} />)
    expect(screen.getByText(/grow an index/i)).toBeInTheDocument()
  })

  it('calls onNavigate with the heading id when an entry is clicked', () => {
    const onNavigate = vi.fn()
    render(
      <TableOfContents
        headings={headings}
        activeId={null}
        open
        onNavigate={onNavigate}
      />,
    )
    fireEvent.click(screen.getByText('Usage'))
    expect(onNavigate).toHaveBeenCalledWith('usage')
  })

  it('marks the active heading with aria-current', () => {
    render(
      <TableOfContents
        headings={headings}
        activeId="api"
        open
        onNavigate={() => {}}
      />,
    )
    const activeButton = screen.getByText('API Reference').closest('button')
    expect(activeButton).toHaveAttribute('aria-current', 'true')

    const inactiveButton = screen.getByText('Usage').closest('button')
    expect(inactiveButton).not.toHaveAttribute('aria-current')
  })

  it('collapses a section to hide its sub-headings', () => {
    render(
      <TableOfContents headings={headings} activeId={null} open onNavigate={() => {}} />,
    )
    expect(screen.getByText('Usage')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /collapse section/i }))

    expect(screen.queryByText('Usage')).not.toBeInTheDocument()
    expect(screen.queryByText('API Reference')).not.toBeInTheDocument()
    // The parent heading itself stays visible.
    expect(screen.getByText('Introduction')).toBeInTheDocument()
  })

  it('re-expands a collapsed section', () => {
    render(
      <TableOfContents headings={headings} activeId={null} open onNavigate={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /collapse section/i }))
    expect(screen.queryByText('Usage')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /expand section/i }))
    expect(screen.getByText('Usage')).toBeInTheDocument()
  })

  it('keeps leaf headings without a collapse toggle', () => {
    const flat: Heading[] = [
      { id: 'one', text: 'One', level: 1 },
      { id: 'two', text: 'Two', level: 1 },
    ]
    render(
      <TableOfContents headings={flat} activeId={null} open onNavigate={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: /collapse section/i })).toBeNull()
  })
})
