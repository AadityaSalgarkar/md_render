import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { Preview } from '../components/Preview'
import { serverTikz } from '../lib/tikz'

// TikZ blocks compiled by the real `md-render --port` binary (Tectonic in a
// child process). Tectonic downloads TeX files on its first use; CI runs
// `md-render --warm-tikz` before this suite.
const REPO = path.resolve(__dirname, '../..')
const binary = [
  path.join(REPO, 'src-tauri/target/debug/app'),
  path.join(REPO, 'src-tauri/target/release/md-render'),
].find((candidate) => existsSync(candidate))

let work = ''
let server: ChildProcess | undefined
let origin = ''
let token = ''

async function waitForServer(url: string): Promise<boolean> {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return true
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

beforeAll(async () => {
  if (!binary) return
  work = realpathSync(mkdtempSync(path.join(tmpdir(), 'md-render-tikz-')))
  writeFileSync(path.join(work, 'doc.md'), '# Doc\n')
  const port = 30000 + Math.floor(Math.random() * 20000)
  origin = `http://127.0.0.1:${port}`
  server = spawn(binary, ['--port', String(port), path.join(work, 'doc.md')], {
    stdio: 'ignore',
    env: {
      ...process.env,
      XDG_STATE_HOME: path.join(work, 'state'),
      MDRENDER_TIKZ_CACHE: path.join(work, 'cache'),
      MDRENDER_TIKZ_TIMEOUT: '8',
    },
  })
  if (!(await waitForServer(origin))) throw new Error('md-render server did not come up')
  token = JSON.parse(readFileSync(path.join(work, 'state/md-render/servers', `${port}.json`), 'utf8')).token
}, 40_000)

afterAll(() => {
  server?.kill()
  if (work) rmSync(work, { recursive: true, force: true })
})

const ARROW = '%! libraries: arrows.meta\n%! caption: An **arrow** from $a$ to $b$.\n\\begin{tikzpicture}\\draw[-Stealth] (0,0) node[left]{$a$} -- (2,0) node[right]{$b$};\\end{tikzpicture}'
const SQUARE = '%! packages: tikz-cd\n\\begin{tikzcd} A \\arrow[r] & B \\end{tikzcd}'

function show(markdown: string) {
  return render(<Preview content={markdown} tocOpen={false} tikz={serverTikz(origin, () => token)} />)
}

async function drawn(count: number) {
  await waitFor(
    () => {
      const figures = screen.getAllByTestId('tikz-diagram')
      expect(figures.filter((f) => f.querySelector('svg')).length).toBe(count)
      expect(figures.some((f) => f.getAttribute('aria-busy'))).toBe(false)
    },
    { timeout: 60_000 },
  )
  return screen.getAllByTestId('tikz-diagram')
}

describe('tikz blocks without a compiler', () => {
  it('say where they can be seen', () => {
    render(<Preview content={'```tikz\n\\draw (0,0) -- (1,1);\n```'} tocOpen={false} />)
    expect(screen.getByRole('alert', { name: 'TikZ error' })).toHaveTextContent('TikZ not available here.')
  })
})

describe.skipIf(!binary)('tikz blocks against the real server', () => {
  it('draws a fence and a tag, with ids that cannot collide, and the caption', async () => {
    show(`# T\n\n\`\`\`tikz\n${ARROW}\n\`\`\`\n\n<tikz>\n${SQUARE}\n</tikz>\n`)
    const figures = await drawn(2)
    const ids = figures.flatMap((f) => [...f.querySelectorAll('svg [id]')].map((e) => e.id))
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    const svg = figures[0].querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.innerHTML).toContain('currentColor')
    const caption = figures[0].querySelector('figcaption.experiment-plot-label')!
    expect(caption.querySelector('strong')?.textContent).toBe('arrow')
    expect(caption.querySelector('.katex')).not.toBeNull()
    expect(figures[1].querySelector('figcaption')).toBeNull()
  }, 90_000)

  it('serves the second render from the cache', async () => {
    const api = serverTikz(origin, () => token)
    const first = await api.render(SQUARE)
    const again = await api.render(SQUARE)
    expect(again.cached).toBe(true)
    expect(again.key).toBe(first.key)
    const response = await fetch(`${origin}/api/tikz/${first.key}.svg`)
    expect(response.headers.get('cache-control')).toContain('immutable')
  }, 60_000)

  it('shows the TeX error lines and the source', async () => {
    show('```tikz\n\\begin{tikzpicture}\\drwa (0,0) -- (1,1);\\end{tikzpicture}\n```')
    const card = await screen.findByRole('alert', { name: 'TikZ error' }, { timeout: 60_000 })
    expect(card).toHaveTextContent('Unable to render TikZ diagram.')
    expect(card).toHaveTextContent('Undefined control sequence')
    expect(within(card).getByText('Source')).toBeInTheDocument()
  }, 90_000)

  it('keeps the old drawing, dimmed, while an edit recompiles', async () => {
    const view = show(`\`\`\`tikz\n${SQUARE}\n\`\`\``)
    const [figure] = await drawn(1)
    const before = figure.querySelector('svg')!.outerHTML
    const edited = SQUARE.replace('B', 'C')
    view.rerender(<Preview content={`\`\`\`tikz\n${edited}\n\`\`\``} tocOpen={false} tikz={serverTikz(origin, () => token)} />)
    const stale = screen.getByTestId('tikz-diagram')
    expect(stale.querySelector('svg')!.outerHTML).toBe(before)
    expect(stale.querySelector('.tikz-frame.is-stale')).not.toBeNull()
    await waitFor(() => expect(screen.getByTestId('tikz-diagram').querySelector('svg')!.outerHTML).not.toBe(before), {
      timeout: 60_000,
    })
    expect(screen.getByTestId('tikz-diagram').querySelector('.is-stale')).toBeNull()
  }, 90_000)

  it('stops a diagram that never finishes', async () => {
    show('```tikz\n\\loop\\iftrue\\repeat\n```')
    const card = await screen.findByRole('alert', { name: 'TikZ error' }, { timeout: 30_000 })
    expect(card).toHaveTextContent('took longer than 8 s')
  }, 40_000)

  it('refuses to compile without the page token', async () => {
    await expect(serverTikz(origin, () => 'wrong').render(SQUARE)).rejects.toMatchObject({ code: 'engine' })
  })
})
