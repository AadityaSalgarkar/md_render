import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommentPane } from '../components/CommentPane'

const props = {
  open: true,
  selectedText: 'a passage',
  threads: [],
  saveState: null,
  exportState: null,
  onSave: () => {},
  onRefresh: () => {},
  onExport: () => {},
  onClose: () => {},
}

describe('CommentPane', () => {
  it('offers composing and exporting by default', () => {
    render(<CommentPane {...props} />)

    expect(screen.getByRole('button', { name: 'Save comment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export clean .md' })).toBeInTheDocument()
    expect(screen.getByLabelText('Comment text')).toBeInTheDocument()
  })

  it('hides everything that writes to disk when read-only', () => {
    // Server mode has no write endpoints, so offering these would only fail.
    render(<CommentPane {...props} readOnly />)

    expect(screen.queryByRole('button', { name: 'Save comment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export clean .md' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Comment text')).not.toBeInTheDocument()
  })

  it('still shows saved comments when read-only', () => {
    render(
      <CommentPane
        {...props}
        readOnly
        threads={[
          {
            id: 'thread-1',
            comment: 'Needs a citation',
            responses: ['Added one'],
            raw: '<chat><comment>Needs a citation</comment></chat>',
          },
        ]}
      />,
    )

    expect(screen.getByText('Needs a citation')).toBeInTheDocument()
  })
})
