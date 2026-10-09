import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Preview } from '../../components/Preview'
import { serverExperiments } from '../../lib/backend'
import { HINT_DELAY_MS } from '../../components/MetricHint'

// The plot component against the real `md-render --port` binary and the
// committed trackio fixture. jsdom has no canvas, so the assertions read
// the data table, the legend and the view picker that sit beside it.
const REPO = path.resolve(__dirname, '../../..')
const FIXTURE = path.join(REPO, 'src/test/fixtures/trackio/demo.db')
const binary = [
  path.join(REPO, 'src-tauri/target/debug/app'),
  path.join(REPO, 'src-tauri/target/release/md-render'),
  path.join(REPO, 'src-tauri/target/release/app'),
].find((candidate) => existsSync(candidate))

function plot(json: Record<string, unknown>): string {
  return `# Report\n\n<plot>\n${JSON.stringify(json, null, 2)}\n</plot>\n`
}

describe('plot blocks without experiment data', () => {
  it('shows the parse error and the source', () => {
    render(<Preview content={'<plot>\n{ "plot_type": "line",\n\n  oops }\n</plot>'} tocOpen={false} />)
    const figure = screen.getByRole('alert', { name: 'Plot error' })
    expect(figure).toHaveTextContent('Unable to render plot.')
    expect(figure).toHaveTextContent('not valid JSON')
    expect(figure.querySelector('code')?.textContent).toContain('oops')
  })

  it('says the plot is not available where no backend can read data', () => {
    render(<Preview content={plot({ plot_type: 'line', source: { project: 'demo' } })} tocOpen={false} />)
    expect(screen.getByRole('alert', { name: 'Plot error' })).toHaveTextContent('Plot not available.')
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
  })

  it('leaves a plot shown inside a code fence as code', () => {
    const { container } = render(<Preview content={'```html\n<plot>\n{}\n</plot>\n```'} tocOpen={false} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(container.querySelector('pre code')?.textContent).toContain('<plot>')
  })
})

let work = ''
let server: ChildProcess | undefined
let origin = ''

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
  work = realpathSync(mkdtempSync(path.join(tmpdir(), 'md-render-plots-')))
  const trackio = path.join(work, 'trackio')
  const docs = path.join(work, 'docs')
  mkdirSync(trackio)
  mkdirSync(docs)
  copyFileSync(FIXTURE, path.join(trackio, 'demo.db'))
  copyFileSync(FIXTURE, path.join(docs, 'runs.db'))
  writeFileSync(path.join(docs, 'report.md'), '# Report\n')
  const port = 30000 + Math.floor(Math.random() * 20000)
  origin = `http://127.0.0.1:${port}`
  server = spawn(binary, ['--port', String(port), path.join(docs, 'report.md')], {
    stdio: 'ignore',
    env: { ...process.env, TRACKIO_DIR: trackio, XDG_STATE_HOME: path.join(work, 'state') },
  })
  if (!(await waitForServer(origin))) throw new Error('md-render server did not come up')
}, 40_000)

afterAll(() => {
  server?.kill()
  if (work) rmSync(work, { recursive: true, force: true })
})

function rows(figure: HTMLElement): string[][] {
  return within(figure)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''))
}

async function renderPlot(json: Record<string, unknown>, baseDir?: string) {
  render(
    <Preview
      content={plot(json)}
      tocOpen={false}
      baseDir={baseDir ?? path.join(work, 'docs')}
      experiments={serverExperiments(origin)}
      documentKey="report.md"
    />,
  )
  const figure = await screen.findByTestId('experiment-plot')
  await waitFor(() => expect(within(figure).getAllByRole('row').length).toBeGreaterThan(1), { timeout: 10_000 })
  await waitFor(() => expect(figure.querySelector('[aria-busy="true"]')).toBeNull())
  return figure
}

describe.skipIf(!binary)('plot blocks against the real server', () => {
  it('lists projects and runs through the server backend', async () => {
    const api = serverExperiments(origin)
    const projects = await api.listProjects()
    expect(projects.projects.map((p) => p.name)).toEqual(['demo'])
    const runs = await api.listRuns({ db: 'runs.db' }, path.join(work, 'docs'))
    expect(runs.runs.map((r) => r.name)).toEqual(['exp_1', 'exp_2', 'exp_3'])
    await expect(api.listRuns({ db: '/etc/hosts.db' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.listRuns({ project: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('draws the default train vs val view with every run, and switches views', async () => {
    const figure = await renderPlot({ plot_type: 'line', source: { project: 'demo' }, metrics: '^(train|val)/loss/' })
    expect(within(figure).getByText('loss/ce: train vs val', { selector: '.experiment-plot-title' })).toBeInTheDocument()
    expect(rows(figure).map((r) => r[0])).toEqual([
      'exp_1 · train/loss/ce',
      'exp_1 · val/loss/ce',
      'exp_2 · train/loss/ce',
      'exp_2 · val/loss/ce',
      'exp_3 · train/loss/ce',
      'exp_3 · val/loss/ce',
    ])
    // Train rows hold every step, validation every fifth, one NaN skipped for exp_2.
    expect(rows(figure).map((r) => r[2])).toEqual(['50', '10', '50', '9', '50', '10'])

    const select = within(figure).getByRole('combobox', { name: 'View' })
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual([
      'loss/ce: train vs val',
      'train/loss components',
      'train/loss/ce across runs',
      'train/loss/kl_teacher_student across runs',
      'val/loss/ce across runs',
      'val/loss/ce by lr',
      'val/loss/ce by model.arch',
      'Custom…',
    ])
    fireEvent.change(select, { target: { value: 'val/loss/ce by model.arch' } })
    await waitFor(() => expect(rows(figure).map((r) => r[0])).toEqual(['conv: exp_1', 'conv: exp_3', 'vit: exp_2']))
  })

  it('hides a series from the legend, and describes metrics on hover', async () => {
    const figure = await renderPlot({
      plot_type: 'line',
      source: { db: 'runs.db' },
      metrics: ['val/loss/ce'],
      descriptions: { '*/loss/ce': 'Cross entropy of the prediction on that split.' },
    })
    const legend = within(figure).getByRole('list', { name: 'Legend' })
    fireEvent.click(within(legend).getByRole('button', { name: 'exp_2' }))
    await waitFor(() => expect(rows(figure).map((r) => r[0])).toEqual(['exp_1', 'exp_3']))
    expect(within(legend).getByRole('button', { name: 'exp_2' })).toHaveAttribute('aria-pressed', 'false')

    const entry = within(legend).getByRole('button', { name: 'exp_1' })
    fireEvent.mouseEnter(entry.parentElement!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await act(() => new Promise((resolve) => setTimeout(resolve, HINT_DELAY_MS + 50)))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('val/loss/ce')
    expect(tooltip).toHaveTextContent('Cross entropy of the prediction on that split.')
    fireEvent.mouseLeave(entry.parentElement!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('applies a custom view from the form', async () => {
    const figure = await renderPlot({ plot_type: 'line', source: { project: 'demo' } })
    fireEvent.change(within(figure).getByRole('combobox', { name: 'View' }), { target: { value: '\u0000custom' } })
    fireEvent.change(within(figure).getByRole('textbox', { name: 'Runs' }), { target: { value: '^exp_3$' } })
    fireEvent.change(within(figure).getByRole('textbox', { name: 'Metrics' }), { target: { value: '^val/acc' } })
    fireEvent.click(within(figure).getByRole('button', { name: 'Apply' }))
    // One run and one key: the legend is the key; the table lists that one series.
    await waitFor(() => expect(rows(figure).map((r) => r.slice(0, 3))).toEqual([['val/acc/top1', 'val/acc/top1', '10']]))
  })

  it('prints the caption under the chart, with inline markdown and math', async () => {
    const figure = await renderPlot({
      plot_type: 'line',
      source: { project: 'demo' },
      metrics: ['val/loss/ce'],
      caption: '**exp_2** reaches the lowest validation loss, about $0.5$ nats below *exp_1*.\n\n- not a list',
    })
    const caption = figure.querySelector('figcaption.experiment-plot-label')!
    expect(caption).not.toBeNull()
    expect(caption.querySelector('strong')?.textContent).toBe('exp_2')
    expect(caption.querySelector('em')?.textContent).toBe('exp_1')
    expect(caption.querySelector('.katex')).not.toBeNull()
    expect(caption.querySelector('ul, li, p')).toBeNull()
    expect(caption).toHaveTextContent('not a list')
    // The caption sits after the chart and its legend.
    const body = figure.querySelector('.experiment-plot-body')!
    expect(body.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('summarises bars with the best value per run', async () => {
    const figure = await renderPlot({
      plot_type: 'bar',
      source: { project: 'demo' },
      summary: 'best',
      items: [
        { run: 'exp_1', metric: 'val/acc/top1', legend_name: 'conv small', metadata: 'lr 1e-3' },
        { run: 'exp_2', metric: 'val/acc/top1', legend_name: 'vit' },
      ],
    })
    expect(within(figure).getByRole('combobox', { name: 'View' })).toHaveValue('Series')
    expect(rows(figure).map((r) => r[0])).toEqual(['conv small', 'vit'])
  })

  it('says which runs exist when the selection matches none', async () => {
    render(
      <Preview
        content={plot({ plot_type: 'line', source: { project: 'demo' }, runs: '^nothing' })}
        tocOpen={false}
        experiments={serverExperiments(origin)}
      />,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('No run matches ^nothing. Runs here: exp_1, exp_2, exp_3.')
  })

  it('refuses a database outside the served folders', async () => {
    const outside = path.join(work, 'outside')
    mkdirSync(outside, { recursive: true })
    copyFileSync(FIXTURE, path.join(outside, 'hidden.db'))
    render(
      <Preview
        content={plot({ plot_type: 'line', source: { db: path.join(outside, 'hidden.db') } })}
        tocOpen={false}
        experiments={serverExperiments(origin)}
      />,
    )
    const figure = await screen.findByRole('alert', { name: 'Plot error' })
    expect(figure).toHaveTextContent('Unable to load experiment data.')
    expect(figure).toHaveTextContent('outside the served directories')
  })
})
