import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Preview } from '../components/Preview'

describe('code block language', () => {
  it('labels a fenced block with its language, for themes that show it', () => {
    const { container } = render(
      <Preview content={'```python\nprint(1)\n```\n\n```\nplain\n```\n'} tocOpen={false} />,
    )
    const wrappers = container.querySelectorAll('.code-block-wrapper')
    expect(wrappers).toHaveLength(2)
    expect(wrappers[0].getAttribute('data-lang')).toBe('python')
    expect(wrappers[1].hasAttribute('data-lang')).toBe(false)
  })
})

describe('bundled New Computer Modern', () => {
  const REPO = path.resolve(__dirname, '../..')
  const fonts = path.join(REPO, 'src/assets/fonts/newcm')

  it('ships every face index.css loads, with its licence and manifest', () => {
    const css = readFileSync(path.join(REPO, 'src/index.css'), 'utf8')
    const urls = [...css.matchAll(/url\('\.\/assets\/fonts\/newcm\/([^']+)'\)/g)].map((m) => m[1])
    expect(urls).toHaveLength(5)
    for (const file of urls) {
      expect(existsSync(path.join(fonts, file)), file).toBe(true)
      // woff2 files start with the "wOF2" signature.
      expect(readFileSync(path.join(fonts, file)).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
    expect(existsSync(path.join(fonts, 'GUST-FONT-LICENSE.txt'))).toBe(true)
    const manifest = readFileSync(path.join(fonts, 'README-mdr-newcm.txt'), 'utf8')
    for (const file of urls) expect(manifest).toContain(file)
  })
})
