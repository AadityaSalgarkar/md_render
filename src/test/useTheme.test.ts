import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../hooks/useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-mode')
    document.documentElement.removeAttribute('style')
  })

  it('defaults to the warm-paper theme', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.themeId).toBe('warm-paper')
  })

  it('applies the theme to the document element', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.dataset.theme).toBe('warm-paper')
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--accent')).not.toBe('')
  })

  it('switches to another registered theme via setTheme', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('terminal')
    })

    expect(result.current.themeId).toBe('terminal')
    expect(document.documentElement.dataset.theme).toBe('terminal')
    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('ignores unknown theme ids', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('does-not-exist')
    })

    expect(result.current.themeId).toBe('warm-paper')
  })

  it('persists the selected theme to localStorage', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('forest')
    })

    expect(localStorage.getItem('md-render-theme')).toBe('forest')
  })

  it('loads a stored theme on mount', () => {
    localStorage.setItem('md-render-theme', 'midnight-ink')
    const { result } = renderHook(() => useTheme())
    expect(result.current.themeId).toBe('midnight-ink')
  })

  it('exposes the full theme list', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.themes.length).toBeGreaterThanOrEqual(5)
  })
})
