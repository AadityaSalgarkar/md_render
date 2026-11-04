import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTheme } from '../hooks/useTheme'
import { bundledPackages } from './themeFixtures'

// The packages in ./themes stand in for the ones a user installed.
const installed = async () => bundledPackages()

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-mode')
    document.documentElement.removeAttribute('style')
  })

  it('defaults to Claudette', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.themeId).toBe('claudette')
  })

  it('applies the theme to the document element and stores its mode', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.dataset.theme).toBe('claudette')
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--accent')).not.toBe('')
    expect(localStorage.getItem('md-render-theme-mode')).toBe('light')
  })

  it('switches between the built-in themes and persists the choice', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('claudette-dark'))
    expect(result.current.themeId).toBe('claudette-dark')
    expect(document.documentElement.dataset.mode).toBe('dark')
    expect(localStorage.getItem('md-render-theme')).toBe('claudette-dark')
    expect(localStorage.getItem('md-render-theme-mode')).toBe('dark')
  })

  it('ignores unknown theme ids', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('does-not-exist'))
    expect(result.current.themeId).toBe('claudette')
  })

  it('adds installed themes to the list and switches to them', async () => {
    const { result } = renderHook(() => useTheme(installed))
    await waitFor(() => expect(result.current.themes.length).toBe(17))
    act(() => result.current.setTheme('nocturne'))
    expect(result.current.themeId).toBe('nocturne')
    expect(document.documentElement.dataset.theme).toBe('nocturne')
    expect(document.documentElement.dataset.mode).toBe('dark')
    expect(localStorage.getItem('md-render-theme')).toBe('nocturne')
  })

  it('keeps a stored installed theme while the packages load, then applies it', async () => {
    localStorage.setItem('md-render-theme', 'latex')
    const { result } = renderHook(() => useTheme(installed))
    // Claudette shows meanwhile, and the stored choice is not overwritten.
    expect(localStorage.getItem('md-render-theme')).toBe('latex')
    await waitFor(() => expect(result.current.themeId).toBe('latex'))
    expect(document.documentElement.dataset.theme).toBe('latex')
  })

  it('applies an installed theme asked for before the packages arrive', async () => {
    const { result } = renderHook(() => useTheme(installed))
    act(() => result.current.setTheme('paradigm'))
    await waitFor(() => expect(result.current.themeId).toBe('paradigm'))
  })

  it('falls back to Claudette when the stored theme is no longer installed', async () => {
    localStorage.setItem('md-render-theme', 'latex')
    const { result } = renderHook(() => useTheme(async () => []))
    await waitFor(() => expect(localStorage.getItem('md-render-theme')).toBe('claudette'))
    expect(result.current.themeId).toBe('claudette')
  })

  it('loads a stored built-in theme on mount', () => {
    localStorage.setItem('md-render-theme', 'claudette-dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current.themeId).toBe('claudette-dark')
  })
})
