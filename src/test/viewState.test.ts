import { beforeEach, describe, expect, it } from 'vitest'
import { pendingViewCommand, readAppliedSeq, writeAppliedSeq } from '../lib/viewState'

const documents = [
  { id: '0', label: 'alpha.md', path: '/notes/alpha.md' },
  { id: '1', label: 'beta.md', path: '/notes/beta.md' },
]

describe('pendingViewCommand', () => {
  it('ignores a view whose seq was already applied', () => {
    expect(pendingViewCommand({ doc: '1', theme: 'forest', seq: 3 }, 3, documents)).toBeNull()
    expect(pendingViewCommand({ doc: '1', theme: 'forest', seq: 2 }, 3, documents)).toBeNull()
    expect(pendingViewCommand(null, 0, documents)).toBeNull()
    // A fresh workspace has nothing to say.
    expect(pendingViewCommand({ doc: null, theme: null, seq: 0 }, 0, documents)).toBeNull()
  })

  it('applies a theme change on its own', () => {
    expect(pendingViewCommand({ doc: null, theme: 'nocturne', seq: 1 }, 0, documents)).toEqual({
      seq: 1,
      theme: 'nocturne',
    })
  })

  it('drops a doc that is not in the tab list but still consumes the seq', () => {
    // The tab was closed after the command was issued.
    expect(pendingViewCommand({ doc: '9', theme: null, seq: 4 }, 1, documents)).toEqual({
      seq: 4,
    })
    expect(pendingViewCommand({ doc: '1', theme: null, seq: 4 }, 1, documents)).toEqual({
      seq: 4,
      doc: '1',
    })
  })
})

describe('applied sequence storage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('persists the applied seq per workspace in sessionStorage', () => {
    expect(readAppliedSeq('notes')).toBe(0)

    writeAppliedSeq('notes', 5)
    expect(readAppliedSeq('notes')).toBe(5)
    // Another workspace's pages keep their own count.
    expect(readAppliedSeq('docs')).toBe(0)
    expect(sessionStorage.getItem('md-render-view-seq:notes')).toBe('5')
  })

  it('treats a missing workspace or garbage as nothing applied', () => {
    expect(readAppliedSeq('')).toBe(0)
    sessionStorage.setItem('md-render-view-seq:notes', 'not a number')
    expect(readAppliedSeq('notes')).toBe(0)
  })
})
