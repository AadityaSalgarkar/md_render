import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from '../components/Header'
import type { DocumentMeta } from '../lib/backend'

const documents: DocumentMeta[] = [
  { id: '0', label: 'first.md', path: '/docs/first.md' },
  { id: '1', label: 'nested/second.md', path: '/docs/nested/second.md' },
  { id: '2', label: 'third.md', path: '/docs/third.md' },
]

const noop = () => {}

describe('TabBar', () => {
  it('stays hidden when only one document is open', () => {
    // A lone tab is just noise — and it means the last document cannot be
    // closed away from under the user.
    const { container } = render(
      <TabBar
        documents={documents.slice(0, 1)}
        activeId="0"
        onSelect={noop}
        onClose={noop}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders one tab per document once there is more than one', () => {
    render(<TabBar documents={documents} activeId="0" onSelect={noop} onClose={noop} />)

    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'first.md' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'nested/second.md' })).toBeInTheDocument()
  })

  it('marks the active document and only that one', () => {
    render(<TabBar documents={documents} activeId="1" onSelect={noop} onClose={noop} />)

    expect(screen.getByRole('tab', { name: 'nested/second.md' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'first.md' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('reports the id of a clicked tab', () => {
    const onSelect = vi.fn()
    render(<TabBar documents={documents} activeId="0" onSelect={onSelect} onClose={noop} />)

    fireEvent.click(screen.getByRole('tab', { name: 'third.md' }))

    expect(onSelect).toHaveBeenCalledWith('2')
  })

  it('shows the full path as a tooltip, since labels can collide', () => {
    render(<TabBar documents={documents} activeId="0" onSelect={noop} onClose={noop} />)

    expect(screen.getByRole('tab', { name: 'first.md' })).toHaveAttribute(
      'title',
      '/docs/first.md',
    )
  })

  it('offers a close control on every tab', () => {
    render(<TabBar documents={documents} activeId="0" onSelect={noop} onClose={noop} />)

    for (const document of documents) {
      expect(
        screen.getByRole('button', { name: `Close ${document.label}` }),
      ).toBeInTheDocument()
    }
  })

  it('closing a tab reports its id without also selecting it', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <TabBar documents={documents} activeId="0" onSelect={onSelect} onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close nested/second.md' }))

    expect(onClose).toHaveBeenCalledWith('1')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
