import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

const invokeMock = vi.hoisted(() => vi.fn())
const closeWindowMock = vi.hoisted(() => vi.fn())
const onCloseRequestedMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => `asset://${path}`,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: closeWindowMock,
    onCloseRequested: onCloseRequestedMock,
  }),
}))

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    invokeMock.mockReset()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_launch_file') return Promise.resolve(null)
      return Promise.reject(new Error(`Unexpected invoke: ${command}`))
    })
    closeWindowMock.mockReset()
    closeWindowMock.mockResolvedValue(undefined)
    onCloseRequestedMock.mockReset()
    onCloseRequestedMock.mockResolvedValue(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders editor textarea when editor is shown', () => {
    render(<App />)
    // Editor is collapsed by default, show it first
    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    expect(textarea).toBeInTheDocument()
  })

  it('renders sample markdown content by default', () => {
    render(<App />)
    // Sample content heading appears in the preview
    expect(
      screen.getByRole('heading', { name: 'Welcome to Literary Atelier' }),
    ).toBeInTheDocument()
  })

  it('updates preview when editor content changes', () => {
    render(<App />)
    // Show editor first
    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')

    fireEvent.change(textarea, { target: { value: '# Test Heading' } })

    expect(screen.getByRole('heading', { name: 'Test Heading' })).toBeInTheDocument()
  })

  it('has a theme picker button', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /choose theme/i })).toBeInTheDocument()
  })

  it('applies a theme selected from the picker', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))

    fireEvent.click(screen.getByRole('menuitemradio', { name: /nocturne/i }))

    expect(document.documentElement.dataset.theme).toBe('nocturne')
  })

  it('has a resizable divider when editor is shown', () => {
    render(<App />)
    // Show editor first
    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const divider = screen.getByLabelText('Resize panes')
    expect(divider).toBeInTheDocument()
    expect(divider).toHaveAttribute('aria-orientation', 'vertical')
    expect(divider).toHaveAttribute('role', 'separator')
  })

  it('persists content to localStorage', async () => {
    render(<App />)
    // Show editor first
    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')

    fireEvent.change(textarea, { target: { value: '# Persisted Content' } })

    // Persistence is gated on async startup initialisation completing first.
    await waitFor(() => {
      expect(localStorage.getItem('md-render-content')).toBe('# Persisted Content')
    })
  })

  it('autosaves editor changes to the opened markdown file every 30 seconds', async () => {
    vi.useFakeTimers()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_launch_file') return Promise.resolve('/tmp/notes.md')
      if (command === 'read_file') return Promise.resolve('# Loaded File')
      if (command === 'write_file') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected invoke: ${command}`))
    })

    render(<App />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Loaded File' })).toBeInTheDocument()
    invokeMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    fireEvent.change(textarea, { target: { value: '# Edited File' } })

    expect(invokeMock).not.toHaveBeenCalledWith('write_file', expect.anything())

    await act(async () => {
      vi.advanceTimersByTime(29_999)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(invokeMock).not.toHaveBeenCalledWith('write_file', expect.anything())

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invokeMock).toHaveBeenCalledWith('write_file', {
      path: '/tmp/notes.md',
      content: '# Edited File',
    })
    expect(screen.getByRole('heading', { name: 'Edited File' })).toBeInTheDocument()
  })

  it('saves editor changes to the opened markdown file when Save is clicked', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_launch_file') return Promise.resolve('/tmp/notes.md')
      if (command === 'read_file') return Promise.resolve('# Loaded File')
      if (command === 'write_file') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected invoke: ${command}`))
    })

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Loaded File' })).toBeInTheDocument()
    invokeMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    fireEvent.change(textarea, { target: { value: '# Manual Save' } })
    fireEvent.click(screen.getByRole('button', { name: /save markdown/i }))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('write_file', {
        path: '/tmp/notes.md',
        content: '# Manual Save',
      })
    })
  })

  it('saves browser drafts when Save is clicked without an opened file', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    fireEvent.change(textarea, { target: { value: '# Local Draft' } })
    localStorage.clear()

    fireEvent.click(screen.getByRole('button', { name: /save markdown/i }))

    expect(localStorage.getItem('md-render-content')).toBe('# Local Draft')
  })

  it('refreshes clean opened markdown files every 30 seconds', async () => {
    vi.useFakeTimers()
    let fileContent = '# Loaded File'
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_launch_file') return Promise.resolve('/tmp/notes.md')
      if (command === 'read_file') return Promise.resolve(fileContent)
      if (command === 'write_file') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected invoke: ${command}`))
    })

    render(<App />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Loaded File' })).toBeInTheDocument()

    fileContent = '# External Update'
    await act(async () => {
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'External Update' })).toBeInTheDocument()
  })

  it('waits for a pending autosave before closing the window', async () => {
    let closeHandler: ((event: { preventDefault: () => void }) => Promise<void> | void) | null = null
    let resolveWrite: (() => void) | null = null
    onCloseRequestedMock.mockImplementation((handler) => {
      closeHandler = handler
      return Promise.resolve(() => {})
    })
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_launch_file') return Promise.resolve('/tmp/notes.md')
      if (command === 'read_file') return Promise.resolve('# Loaded File')
      if (command === 'write_file') {
        return new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
      }
      return Promise.reject(new Error(`Unexpected invoke: ${command}`))
    })

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Loaded File' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    fireEvent.change(textarea, { target: { value: '# Edited File' } })
    expect(invokeMock).not.toHaveBeenCalledWith('write_file', expect.anything())
    expect(closeHandler).toBeTruthy()

    const event = { preventDefault: vi.fn() }
    const closePromise = Promise.resolve(closeHandler!(event))
    expect(event.preventDefault).toHaveBeenCalled()
    expect(closeWindowMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('write_file', {
        path: '/tmp/notes.md',
        content: '# Edited File',
      })
      expect(resolveWrite).toBeTruthy()
    })

    resolveWrite!()
    await closePromise

    expect(closeWindowMock).toHaveBeenCalled()
  })

  it('starts with editor collapsed by default', () => {
    render(<App />)
    // Should show "Edit" button since editor is collapsed
    const toggleButton = screen.getByRole('button', { name: /show editor/i })
    expect(toggleButton).toBeInTheDocument()
  })

  it('shows editor when toggle button is clicked', () => {
    render(<App />)
    const toggleButton = screen.getByRole('button', { name: /show editor/i })

    fireEvent.click(toggleButton)

    // Button label should change to "Hide editor"
    expect(screen.getByRole('button', { name: /hide editor/i })).toBeInTheDocument()
  })

  it('shows the document index by default', () => {
    render(<App />)
    const indexButton = screen.getByRole('button', { name: /hide document index/i })
    expect(indexButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles the document index off', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /hide document index/i }))

    const indexButton = screen.getByRole('button', { name: /show document index/i })
    expect(indexButton).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('md-render-toc')).toBe('false')
  })

  it('shows saved comments and responses in the comments pane', async () => {
    localStorage.setItem(
      'md-render-content',
      'Visible text.\n<chat><comment>Review this sentence.</comment><response>Suggested response.</response></chat>',
    )
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /show comments/i }))

    expect(await screen.findByText('Review this sentence.')).toBeInTheDocument()
    expect(screen.getByText('Suggested response.')).toBeInTheDocument()
    expect(screen.getAllByText('Visible text.')).toHaveLength(1)
  })

  it('closes the comments pane when review work is done', async () => {
    localStorage.setItem(
      'md-render-content',
      'Visible text.\n<chat><comment>Review this sentence.</comment></chat>',
    )
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /show comments/i }))
    expect(await screen.findByRole('complementary', { name: /comments/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close comments/i }))

    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: /comments/i })).not.toBeInTheDocument()
    })
  })

  it('refreshes rendered text when review work is done', async () => {
    localStorage.setItem(
      'md-render-content',
      'Original rendered text.\n<chat><comment>Review this sentence.</comment></chat>',
    )
    render(<App />)

    expect(await screen.findByText('Original rendered text.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show comments/i }))
    expect(await screen.findByRole('complementary', { name: /comments/i })).toBeInTheDocument()

    localStorage.setItem(
      'md-render-content',
      'Updated rendered text.\n<chat><comment>Review this sentence.</comment></chat>',
    )
    fireEvent.click(screen.getByRole('button', { name: /close comments/i }))

    expect(await screen.findByText('Updated rendered text.')).toBeInTheDocument()
    expect(screen.queryByText('Original rendered text.')).not.toBeInTheDocument()
  })
})
