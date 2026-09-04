import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'

// The Tauri IPC layer is not in play here: the page is told it is being
// served, so it talks HTTP. That HTTP surface is answered by an in-memory
// route table below (the real server has its own tests for it).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: () => Promise.reject(new Error('desktop IPC must not be used in server mode')),
  convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: vi.fn(), onCloseRequested: vi.fn() }),
}))

type Marker = {
  __MD_RENDER_SERVER__?: boolean
  __MD_RENDER_TOKEN__?: string
  __MD_RENDER_WORKSPACE__?: string
}

const docs = [
  { id: 0, label: 'alpha.md', path: '/notes/alpha.md', workspace: 'notes' },
  { id: 1, label: 'beta.md', path: '/notes/beta.md', workspace: 'notes' },
]
const contents: Record<number, string> = {
  0: '# Alpha document',
  1: '# Beta document',
}

let view: { doc: number | null; theme: string | null; seq: number }
let reads: number[]
const realFetch = globalThis.fetch

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/notes/')
  document.documentElement.removeAttribute('data-theme')
  const marker = window as Marker
  marker.__MD_RENDER_SERVER__ = true
  marker.__MD_RENDER_TOKEN__ = 'token'
  marker.__MD_RENDER_WORKSPACE__ = 'notes'

  view = { doc: null, theme: null, seq: 0 }
  reads = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    if (url.pathname === '/api/files') return json(docs)
    if (url.pathname === '/api/view') return json(view)
    if (url.pathname === '/api/file') {
      const id = Number(url.searchParams.get('id'))
      const doc = docs.find((d) => d.id === id)
      if (!doc) return new Response('no such document', { status: 404 })
      reads.push(id)
      return json({ ...doc, base_dir: '/notes', content: contents[id] })
    }
    return new Response('unexpected route ' + url.pathname, { status: 500 })
  }) as typeof fetch

  // Only the poll interval is faked; everything else (React, waitFor) keeps
  // real timers.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = realFetch
  const marker = window as Marker
  delete marker.__MD_RENDER_SERVER__
  delete marker.__MD_RENDER_TOKEN__
  delete marker.__MD_RENDER_WORKSPACE__
})

async function renderServed() {
  render(<App />)
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute('aria-selected', 'true')
  })
}

const nextPoll = () => vi.advanceTimersByTimeAsync(3_000)

describe('view state pushed by the server', () => {
  it("focuses the tab named by the server's view state on the next poll", async () => {
    await renderServed()

    view = { doc: 1, theme: null, seq: 1 }
    await nextPoll()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'beta.md' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.getByRole('heading', { name: 'Beta document' })).toBeInTheDocument()
    expect(sessionStorage.getItem('md-render-view-seq:notes')).toBe('1')
  })

  it('switches theme when the view state carries one', async () => {
    await renderServed()
    expect(document.documentElement.dataset.theme).not.toBe('nocturne')

    view = { doc: null, theme: 'nocturne', seq: 1 }
    await nextPoll()

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('nocturne')
    })
    // The tab was left alone.
    expect(screen.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not re-apply the same view sequence on later polls', async () => {
    await renderServed()

    view = { doc: 1, theme: null, seq: 1 }
    await nextPoll()
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'beta.md' })).toHaveAttribute('aria-selected', 'true')
    })

    // The reader goes back to alpha by hand.
    fireEvent.click(screen.getByRole('tab', { name: 'alpha.md' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute('aria-selected', 'true')
    })
    const readsBefore = reads.length

    // The unchanged command is not applied again, so alpha stays.
    await nextPoll()
    await nextPoll()
    expect(reads.length).toBe(readsBefore)
    expect(screen.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not re-apply a view after reload when the seq is already in sessionStorage', async () => {
    // This browser tab already acted on seq 1 before it was reloaded.
    sessionStorage.setItem('md-render-view-seq:notes', '1')
    view = { doc: 1, theme: null, seq: 1 }

    await renderServed()
    await nextPoll()

    expect(screen.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute('aria-selected', 'true')
    expect(reads).toEqual([0])
  })
})
