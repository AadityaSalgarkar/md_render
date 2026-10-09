import { describe, expect, it } from 'vitest'
import { TikzError, isTikzLanguage, prepareTikzBlocks, sanitizeSvg, tikzCaption } from '../lib/tikz'
import { preparePlotBlocks } from '../lib/plotBlocks'

describe('tikz blocks', () => {
  it('turns a tag into a tikz fence and leaves fences and other code alone', () => {
    expect(prepareTikzBlocks('<tikz>\n\\draw (0,0) -- (1,1);\n\n\\draw (1,1) -- (2,0);\n</tikz>')).toBe(
      '```tikz\n\\draw (0,0) -- (1,1);\n\n\\draw (1,1) -- (2,0);\n```',
    )
    expect(prepareTikzBlocks('```tikz\n\\draw;\n```')).toBe('```tikz\n\\draw;\n```')
    const example = '```html\n<tikz>\n\\draw;\n</tikz>\n```'
    expect(prepareTikzBlocks(example)).toBe(example)
  })

  it('works alongside plot blocks', () => {
    const doc = '<plot>\n{"a": 1}\n</plot>\n\n<tikz>\n\\draw;\n</tikz>'
    expect(prepareTikzBlocks(preparePlotBlocks(doc))).toBe('```md-plot\n{"a": 1}\n```\n\n```tikz\n\\draw;\n```')
  })

  it('recognises the fence language and reads the caption header', () => {
    expect(isTikzLanguage('language-tikz')).toBe(true)
    expect(isTikzLanguage('hljs language-TikZ')).toBe(true)
    expect(isTikzLanguage('language-latex')).toBe(false)
    expect(tikzCaption('%! packages: pgfplots\n%!caption: The lesson.\n\\draw;')).toBe('The lesson.')
    expect(tikzCaption('\\draw;')).toBe('')
  })

  it('keeps drawing elements only and strips anything that could run', () => {
    const dirty = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="30" height="15" viewBox="0 0 30 15" onload="alert(1)">',
      '<script>alert(1)</script>',
      '<foreignObject><div>html</div></foreignObject>',
      '<defs><path id="tkx-g1" d="M0 0L1 1"/></defs>',
      '<use href="#tkx-g1" fill="currentColor" onclick="alert(2)"/>',
      '<a href="https://example.com"><path d="M0 0"/></a>',
      '<image href="https://example.com/x.png"/>',
      '<path d="M0 0" fill="#ffffff" stroke="white"/>',
      '</svg>',
    ].join('')
    const clean = sanitizeSvg(dirty)!
    expect(clean).not.toMatch(/script|foreignObject|onload|onclick|example\.com|<a /)
    expect(clean).toContain('href="#tkx-g1"')
    expect(clean).toContain('width="40"')
    expect(clean).toContain('height="20"')
    expect(clean).toContain('viewBox="0 0 30 15"')
    expect(clean).toContain('fill:var(--tikz-paper, #fff)')
    expect(clean).toContain('stroke:var(--tikz-paper, #fff)')
    expect(clean).not.toContain('#ffffff')
    expect(sanitizeSvg('<html><body>not svg</body></html>')).toBeNull()
  })

  it('reads the backend error shape', () => {
    const err = TikzError.from('{"error":"tex","message":"! Undefined control sequence.","log":["! Undefined control sequence.","l.3 \\\\drwa"]}')
    expect(err.code).toBe('tex')
    expect(err.log).toHaveLength(2)
    expect(TikzError.from('plain text').code).toBe('engine')
  })
})
