import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../hooks/useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('defaults to light theme', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('toggles theme from light to dark', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggles theme from dark to light', () => {
    localStorage.setItem('md-render-theme', 'dark')
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists theme to localStorage', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.toggleTheme()
    })

    expect(localStorage.getItem('md-render-theme')).toBe('dark')
  })

  it('loads theme from localStorage on mount', () => {
    localStorage.setItem('md-render-theme', 'dark')
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
  })

  it('adds dark class to document element when dark theme', () => {
    localStorage.setItem('md-render-theme', 'dark')
    renderHook(() => useTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
