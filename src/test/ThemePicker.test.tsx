import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ThemePicker } from '../components/ThemePicker'
import { themes, themeSwatch } from '../lib/themes'

// The real picker over the real theme registry, holding its own selection
// the way App does.
function Harness({ initial = 'warm-paper' }: { initial?: string }) {
  const [active, setActive] = useState(initial)
  return (
    <>
      <ThemePicker themes={themes} activeId={active} onSelect={setActive} />
      <output data-testid="active">{active}</output>
    </>
  )
}

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Choose theme' }))
  return screen.getByRole('menu', { name: 'Themes' })
}

describe('ThemePicker', () => {
  it('lists every theme, light then dark, each with its three colour squares', () => {
    render(<Harness />)
    const menu = openMenu()

    const light = within(menu).getByRole('group', { name: 'Light' })
    const dark = within(menu).getByRole('group', { name: 'Dark' })
    const lightIds = within(light).getAllByRole('menuitemradio').map((b) => b.dataset.themeId)
    const darkIds = within(dark).getAllByRole('menuitemradio').map((b) => b.dataset.themeId)
    expect(lightIds).toEqual(themes.filter((t) => t.mode === 'light').map((t) => t.id))
    expect(darkIds).toEqual(themes.filter((t) => t.mode === 'dark').map((t) => t.id))
    expect(lightIds.length + darkIds.length).toBe(themes.length)

    for (const theme of themes) {
      const row = menu.querySelector(`[data-theme-id="${theme.id}"]`)!
      expect(row.textContent).toContain(theme.name)
      expect(row.getAttribute('title')).toBe(theme.blurb)
      const squares = Array.from(row.querySelectorAll<HTMLElement>('.theme-square'))
      expect(squares).toHaveLength(3)
      const expected = themeSwatch(theme).map((hex) => {
        const probe = document.createElement('span')
        probe.style.background = hex
        return probe.style.background
      })
      expect(squares.map((s) => s.style.background)).toEqual(expected)
    }
  })

  it('opens on the active theme, marked checked', () => {
    render(<Harness initial="latex-dark" />)
    const menu = openMenu()
    const active = within(menu).getByRole('menuitemradio', { checked: true })
    expect(active.dataset.themeId).toBe('latex-dark')
    expect(document.activeElement).toBe(active)
    expect(within(menu).getAllByRole('menuitemradio', { checked: true })).toHaveLength(1)
  })

  it('moves with the arrow keys across both groups, wrapping, and Home and End', () => {
    render(<Harness />)
    const menu = openMenu()
    const ids = [
      ...themes.filter((t) => t.mode === 'light'),
      ...themes.filter((t) => t.mode === 'dark'),
    ].map((t) => t.id)
    const focused = () => (document.activeElement as HTMLElement).dataset.themeId

    expect(focused()).toBe('warm-paper')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe(ids[1])
    fireEvent.keyDown(menu, { key: 'End' })
    expect(focused()).toBe(ids[ids.length - 1])
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe(ids[0])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(focused()).toBe(ids[ids.length - 1])
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(focused()).toBe(ids[0])
  })

  it('picks a theme on click and returns focus to the button', async () => {
    render(<Harness />)
    const menu = openMenu()
    fireEvent.click(menu.querySelector('[data-theme-id="claudette-dark"]')!)

    expect(screen.getByTestId('active').textContent).toBe('claudette-dark')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose theme' }))
  })

  it('closes on Escape without changing the theme', () => {
    render(<Harness initial="sonnet" />)
    const menu = openMenu()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Escape' })

    expect(screen.getByTestId('active').textContent).toBe('sonnet')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose theme' }))
  })
})
