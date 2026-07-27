import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

// The Tauri layer is not under test here; these mocks let App mount in jsdom
// exactly as the other App suites do.
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: vi.fn(), onCloseRequested: vi.fn() }),
}))

/** Select the given rendered text and mouse-up over the article. */
function selectInPreview(text: string) {
  // getAllByText also matches the editor textarea via its value; the article
  // paragraph is the one the selection handler cares about.
  const node = screen
    .getAllByText(text)
    .find((el) => el.closest('article.markdown-body') !== null)
  expect(node).toBeDefined()
  const range = document.createRange()
  range.selectNodeContents(node!)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(node!)
}

function commentsButton(): HTMLElement {
  return screen.getByRole('button', { name: /show comments|hide comments/i })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  invokeMock.mockReset()
  invokeMock.mockImplementation((command: string) => {
    if (command === 'get_launch_file') return Promise.resolve(null)
    if (command === 'list_documents') return Promise.resolve([])
    return Promise.reject(new Error(`Unexpected invoke: ${command}`))
  })
  localStorage.setItem('md-render-content', 'Selectable passage of text.')
})

describe('highlight-to-comment mode', () => {
  it('ignores text selection while disabled (the default)', async () => {
    render(<App />)
    await screen.findAllByText('Selectable passage of text.')

    selectInPreview('Selectable passage of text.')

    // No comments pane, no captured selection.
    expect(screen.queryByRole('complementary', { name: /comments/i })).toBeNull()
    expect(commentsButton()).toHaveAttribute('data-comment-mode', 'off')
  })

  it('double-clicking the comments button arms the mode; selection then comments', async () => {
    render(<App />)
    await screen.findAllByText('Selectable passage of text.')

    fireEvent.dblClick(commentsButton())
    expect(commentsButton()).toHaveAttribute('data-comment-mode', 'on')

    selectInPreview('Selectable passage of text.')

    const pane = await screen.findByRole('complementary', { name: /comments/i })
    expect(pane).toBeInTheDocument()
    // The selection landed in the composer.
    expect(screen.getByRole('region', { name: /add comment/i })).toHaveTextContent(
      'Selectable passage of text.',
    )
  })

  it('double-clicking again disarms the mode', async () => {
    render(<App />)
    await screen.findAllByText('Selectable passage of text.')

    fireEvent.dblClick(commentsButton())
    fireEvent.dblClick(commentsButton())
    expect(commentsButton()).toHaveAttribute('data-comment-mode', 'off')

    selectInPreview('Selectable passage of text.')
    expect(screen.queryByRole('complementary', { name: /comments/i })).toBeNull()
  })

  it('a double click does not also toggle the pane', async () => {
    render(<App />)
    await screen.findAllByText('Selectable passage of text.')

    fireEvent.click(commentsButton())
    fireEvent.click(commentsButton())
    fireEvent.dblClick(commentsButton())

    // Give the deferred single-click window time to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(screen.queryByRole('complementary', { name: /comments/i })).toBeNull()
    expect(commentsButton()).toHaveAttribute('data-comment-mode', 'on')
  })

  it('a single click still toggles the pane, shortly deferred', async () => {
    render(<App />)
    await screen.findAllByText('Selectable passage of text.')

    fireEvent.click(commentsButton())
    expect(await screen.findByRole('complementary', { name: /comments/i })).toBeInTheDocument()
    // Mode stays off — opening the pane is not arming.
    expect(commentsButton()).toHaveAttribute('data-comment-mode', 'off')
  })

  it('a long press arms the mode without toggling the pane', async () => {
    render(<App />)
    await screen.findAllByText('Selectable passage of text.')

    const button = commentsButton()
    fireEvent.pointerDown(button)
    await new Promise((resolve) => setTimeout(resolve, 600))
    fireEvent.pointerUp(button)
    fireEvent.click(button) // browsers fire a click after pointerup

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(button).toHaveAttribute('data-comment-mode', 'on')
    expect(screen.queryByRole('complementary', { name: /comments/i })).toBeNull()
  })

  it('a short press is just a click, not a long press', async () => {
    render(<App />)
    await screen.findAllByText('Selectable passage of text.')

    const button = commentsButton()
    fireEvent.pointerDown(button)
    fireEvent.pointerUp(button)
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /comments/i })).toBeInTheDocument()
    })
    expect(button).toHaveAttribute('data-comment-mode', 'off')
  })
})
