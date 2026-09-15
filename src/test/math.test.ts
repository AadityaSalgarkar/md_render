import { describe, expect, it } from 'vitest'
import { normalizeMath } from '../lib/math'

describe('normalizeMath', () => {
  it('leaves markdown without MathJax constructs untouched', () => {
    const plain = '# Title\n\nSome $x$ and\n\n$$\ny = 2\n$$\n'
    expect(normalizeMath(plain)).toBe(plain)
  })

  it('turns bracket delimiters into dollar ones', () => {
    const src = 'Let \\(x_t\\) satisfy\n\n\\[dX_t = a\\,dt + b\\,dW_t\\]\n\nwhere \\(a\\) is drift.'
    expect(normalizeMath(src)).toBe(
      'Let $x_t$ satisfy\n\n$$\ndX_t = a\\,dt + b\\,dW_t\n$$\n\nwhere $a$ is drift.',
    )
  })

  it('puts display math on its own lines even when it sits inside a paragraph', () => {
    expect(normalizeMath('so \\[a=b\\] and')).toBe('so \n$$\na=b\n$$\n and')
    expect(normalizeMath('so \\begin{equation}x\\end{equation} and')).toBe(
      'so \n$$\n\\begin{equation}x \\tag{1}\\end{equation}\n$$\n and',
    )
  })

  it('wraps a bare align environment in display math and numbers each row', () => {
    const src = 'Then\n\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}\ndone.'
    expect(normalizeMath(src)).toBe(
      'Then\n$$\n\\begin{align}\na &= b \\tag{1} \\\\\nc &= d \\tag{2}\n\\end{align}\n$$\ndone.',
    )
  })

  it('numbers an equation once and an equation inside $$ without re-wrapping', () => {
    const src = '$$\n\\begin{equation}\nE = mc^2\n\\end{equation}\n$$'
    expect(normalizeMath(src)).toBe('$$\n\\begin{equation}\nE = mc^2 \\tag{1}\n\\end{equation}\n$$')
  })

  it('resolves labels to numbers in eqref, forwards and backwards', () => {
    const src = [
      'See \\eqref{eq:second} below and \\eqref{eq:first}.',
      '',
      '\\begin{equation}\\label{eq:first} a = 1 \\end{equation}',
      '',
      '\\begin{align}',
      'b &= 2 \\label{eq:second} \\\\',
      'c &= 3 \\nonumber \\\\',
      'd &= 4 \\label{eq:third}',
      '\\end{align}',
      '',
      'Also \\eqref{eq:third} and \\eqref{missing}.',
    ].join('\n')
    const out = normalizeMath(src)
    expect(out).toContain('See (2) below and (1).')
    expect(out).toContain('Also (3) and (?).')
    expect(out).toContain('a = 1 \\tag{1}')
    expect(out).toContain('b &= 2 \\tag{2} \\\\')
    expect(out).toContain('c &= 3 \\nonumber \\\\')
    expect(out).toContain('d &= 4 \\tag{3}')
    expect(out).not.toContain('\\label')
  })

  it('does not number starred environments or rows that already carry a tag', () => {
    const src = '\\begin{align*}\nx &= y\n\\end{align*}\n\n\\begin{equation}\nz = 0 \\tag{A}\n\\end{equation}'
    const out = normalizeMath(src)
    expect(out).toContain('$$\n\\begin{align*}\nx &= y\n\\end{align*}\n$$')
    expect(out).toContain('z = 0 \\tag{A}')
    expect(out).not.toContain('\\tag{1}')
  })

  it('splits rows only at top-level line breaks', () => {
    const src =
      '\\begin{align}\nf(x) &= \\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases} \\\\\ng &= h\n\\end{align}'
    const out = normalizeMath(src)
    expect(out).toContain('\\end{cases} \\tag{1} \\\\')
    expect(out).toContain('g &= h \\tag{2}')
    expect(out).not.toContain('x > 0 \\tag')
  })

  it('leaves code fences and inline code alone', () => {
    const src = [
      'Inline `\\(not math\\)` stays.',
      '',
      '```latex',
      '\\begin{align}',
      'raw &= source',
      '\\end{align}',
      '\\[also raw\\]',
      '```',
      '',
      'But \\(this\\) converts.',
    ].join('\n')
    const out = normalizeMath(src)
    expect(out).toContain('Inline `\\(not math\\)` stays.')
    expect(out).toContain('```latex\n\\begin{align}\nraw &= source\n\\end{align}\n\\[also raw\\]\n```')
    expect(out).toContain('But $this$ converts.')
  })
})
