import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

// The Tauri IPC layer is not under test here; this in-memory document store
// answers the same invoke surface the Rust side implements (and the Rust side
// has its own tests for the real store).
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: vi.fn(), onCloseRequested: vi.fn() }),
}))

let docs: Array<{ id: number; label: string; path: string }>
const contents: Record<string, string> = {
  '/notes/alpha.md': '# Alpha document',
  '/notes/beta.md': '# Beta document',
  '/notes/gamma.md': '# Gamma document',
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  docs = [
    { id: 0, label: 'alpha.md', path: '/notes/alpha.md' },
    { id: 1, label: 'beta.md', path: '/notes/beta.md' },
    { id: 2, label: 'gamma.md', path: '/notes/gamma.md' },
  ]
  invokeMock.mockReset()
  invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case 'get_launch_file':
        return Promise.resolve(null)
      case 'list_documents':
        return Promise.resolve([...docs])
      case 'remove_document':
        docs = docs.filter((doc) => String(doc.id) !== (args?.id as string))
        return Promise.resolve([...docs])
      case 'read_file':
        return Promise.resolve(contents[args?.path as string] ?? '')
      case 'write_file':
        return Promise.resolve()
      default:
        return Promise.reject(new Error(`Unexpected invoke: ${command}`))
    }
  })
})

async function renderWithTabs() {
  render(<App />)
  await screen.findByRole('tab', { name: 'alpha.md' })
  // The first document loads and becomes the active tab.
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
}

describe('closing tabs in the desktop app', () => {
  it('closing an inactive tab keeps the active document in place', async () => {
    await renderWithTabs()

    fireEvent.click(screen.getByRole('button', { name: 'Close beta.md' }))

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'beta.md' })).toBeNull()
    })
    expect(invokeMock).toHaveBeenCalledWith('remove_document', { id: '1' })
    expect(screen.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('closing the active tab activates the neighbour that takes its place', async () => {
    await renderWithTabs()

    fireEvent.click(screen.getByRole('button', { name: 'Close alpha.md' }))

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'alpha.md' })).toBeNull()
    })
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'beta.md' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
  })

  it('closing down to one document hides the tab strip', async () => {
    await renderWithTabs()

    fireEvent.click(screen.getByRole('button', { name: 'Close beta.md' }))
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'beta.md' })).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close gamma.md' }))

    await waitFor(() => {
      expect(screen.queryByRole('tablist')).toBeNull()
    })
    // The surviving document is still what the app shows.
    expect(invokeMock).toHaveBeenCalledWith('remove_document', { id: '2' })
  })
})
