import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from '../components/Editor'

describe('Editor', () => {
  it('renders textarea with placeholder', () => {
    const onChange = vi.fn()
    render(<Editor value="" onChange={onChange} />)

    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    expect(textarea).toBeInTheDocument()
  })

  it('displays the provided value', () => {
    const onChange = vi.fn()
    render(<Editor value="# Hello" onChange={onChange} />)

    const textarea = screen.getByDisplayValue('# Hello')
    expect(textarea).toBeInTheDocument()
  })

  it('calls onChange when text is entered', () => {
    const onChange = vi.fn()
    render(<Editor value="" onChange={onChange} />)

    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    fireEvent.change(textarea, { target: { value: 'New content' } })

    expect(onChange).toHaveBeenCalledWith('New content')
  })

  it('has spellcheck disabled', () => {
    const onChange = vi.fn()
    render(<Editor value="" onChange={onChange} />)

    const textarea = screen.getByPlaceholderText('Start writing your markdown here...')
    expect(textarea).toHaveAttribute('spellcheck', 'false')
  })

  it('handles tab key for indentation', () => {
    const onChange = vi.fn()
    render(<Editor value="text" onChange={onChange} />)

    const textarea = screen.getByPlaceholderText('Start writing your markdown here...') as HTMLTextAreaElement
    textarea.selectionStart = 4
    textarea.selectionEnd = 4

    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(onChange).toHaveBeenCalledWith('text  ')
  })
})
