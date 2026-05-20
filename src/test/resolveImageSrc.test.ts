import { describe, it, expect } from 'vitest'
import { dirname, resolvePath, resolveImageSrc } from '../lib/resolveImageSrc'

describe('dirname', () => {
  it('returns the parent directory', () => {
    expect(dirname('/notes/papers/regimes.md')).toBe('/notes/papers')
  })

  it('handles a root-level file', () => {
    expect(dirname('/regimes.md')).toBe('/')
  })

  it('returns empty for a bare filename', () => {
    expect(dirname('regimes.md')).toBe('')
  })
})

describe('resolvePath', () => {
  it('joins a relative path onto the base directory', () => {
    expect(resolvePath('/docs', 'pic.png')).toBe('/docs/pic.png')
  })

  it('normalizes ./ segments', () => {
    expect(resolvePath('/docs', './img/pic.png')).toBe('/docs/img/pic.png')
  })

  it('normalizes ../ segments', () => {
    expect(resolvePath('/docs/sub', '../img/pic.png')).toBe('/docs/img/pic.png')
  })

  it('passes absolute paths through', () => {
    expect(resolvePath('/docs', '/abs/pic.png')).toBe('/abs/pic.png')
  })

  it('unwraps file:// URLs', () => {
    expect(resolvePath('/docs', 'file:///abs/pic.png')).toBe('/abs/pic.png')
  })

  it('leaves a relative path unresolved when there is no base directory', () => {
    expect(resolvePath(null, 'pic.png')).toBe('pic.png')
  })
})

describe('resolveImageSrc', () => {
  it('returns remote URLs unchanged', () => {
    const url = 'https://example.com/a.png'
    expect(resolveImageSrc(url, '/docs')).toBe(url)
  })

  it('returns data URIs unchanged', () => {
    const uri = 'data:image/png;base64,AAAA'
    expect(resolveImageSrc(uri, '/docs')).toBe(uri)
  })

  it('returns an empty string for a missing src', () => {
    expect(resolveImageSrc(undefined, '/docs')).toBe('')
  })

  it('resolves a local relative path against the base directory', () => {
    // Outside Tauri, convertFileSrc throws and it degrades to the resolved path.
    expect(resolveImageSrc('img/pic.png', '/docs')).toBe('/docs/img/pic.png')
  })
})
