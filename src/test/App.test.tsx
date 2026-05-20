import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
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
})
