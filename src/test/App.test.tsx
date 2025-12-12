import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../App'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
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
    // Check for sample content heading in preview
    expect(screen.getByText('Welcome to Literary Atelier')).toBeInTheDocument()
  })

  it('updates preview when editor content changes', () => {
    render(<App />)
    // Show editor first
    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')

    fireEvent.change(textarea, { target: { value: '# Test Heading' } })

    expect(screen.getByRole('heading', { name: 'Test Heading' })).toBeInTheDocument()
  })

  it('has a theme toggle button', () => {
    render(<App />)
    const themeButton = screen.getByRole('button', { name: /switch to/i })
    expect(themeButton).toBeInTheDocument()
  })

  it('toggles theme when theme button is clicked', () => {
    render(<App />)
    const themeButton = screen.getByRole('button', { name: /switch to dark theme/i })

    fireEvent.click(themeButton)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
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

  it('persists content to localStorage', () => {
    render(<App />)
    // Show editor first
    fireEvent.click(screen.getByRole('button', { name: /show editor/i }))
    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')

    fireEvent.change(textarea, { target: { value: '# Persisted Content' } })

    expect(localStorage.getItem('md-render-content')).toBe('# Persisted Content')
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
})
