// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Drives the real MCP bundle over stdio, which in turn drives real
// `md-render --port` processes over HTTP. Nothing is stubbed: if the bundle or
// the binary is not built, the suite says so rather than pretending to pass.
const REPO = path.resolve(__dirname, '../..')
const BUNDLE = path.join(REPO, 'mcp/dist/index.js')
const CANDIDATES = [
  path.join(REPO, 'src-tauri/target/debug/app'),
  path.join(REPO, 'src-tauri/target/release/md-render'),
  path.join(REPO, 'src-tauri/target/release/app'),
]
const binary = CANDIDATES.find((candidate) => existsSync(candidate))
const bundle = existsSync(BUNDLE) ? BUNDLE : undefined

const ALL_TOOLS = [
  'list_servers',
  'start_server',
  'stop_server',
  'list_workspaces',
  'open_directory',
  'close_workspace',
  'list_tabs',
  'open_tab',
  'close_tab',
  'refresh',
  'read_document',
  'write_document',
  'add_comment',
  'export_clean',
  'focus_tab',
  'set_theme',
]

function pickPort(): number {
  return 30000 + Math.floor(Math.random() * 20000)
}

let work: string
let stateDir: string
let client: Client
let project: string
let docs: string
let notes: string
let api: string
let setup: string
const portA = pickPort()
const portB = pickPort() + 1

type ToolResult = { ok: boolean; text: string; data: Record<string, unknown> }

/** Call a tool and hand back its JSON payload, or its error text. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  let result: { isError?: boolean; content: unknown }
  try {
    result = (await client.callTool({ name, arguments: args })) as typeof result
  } catch (err) {
    // Schema validation failures surface as protocol errors.
    return { ok: false, text: (err as Error).message, data: {} }
  }
  const content = result.content as Array<{ type: string; text: string }>
  const text = content.map((part) => part.text).join('\n')
  if (result.isError) return { ok: false, text, data: {} }
  return { ok: true, text, data: JSON.parse(text) as Record<string, unknown> }
}

async function expectOk(name: string, args: Record<string, unknown> = {}) {
  const result = await call(name, args)
  expect(result.ok, `${name} failed: ${result.text}`).toBe(true)
  return result.data
}

beforeAll(async () => {
  if (!binary || !bundle) return

  work = realpathSync(mkdtempSync(path.join(tmpdir(), 'md-render-mcp-')))
  stateDir = path.join(work, 'state')
  project = path.join(work, 'project')
  docs = path.join(project, 'docs')
  mkdirSync(path.join(docs, 'guide'), { recursive: true })
  notes = path.join(project, 'notes.md')
  api = path.join(docs, 'api.md')
  setup = path.join(docs, 'guide', 'setup.md')
  writeFileSync(notes, '# Notes\n\nThe quick brown fox.\n\nAnother paragraph.\n')
  writeFileSync(api, '# API\n')
  writeFileSync(setup, '# Setup\n')

  client = new Client({ name: 'mcp-test', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bundle],
      env: { ...process.env, XDG_STATE_HOME: stateDir, MDRENDER_BIN: binary } as Record<string, string>,
      stderr: 'pipe',
    }),
  )
}, 30_000)

afterAll(async () => {
  if (!binary || !bundle) return
  // Anything still running gets a signal, so a failing test cannot leak a
  // server past the run.
  const servers = path.join(stateDir, 'md-render', 'servers')
  if (existsSync(servers)) {
    for (const name of readdirSync(servers)) {
      try {
        const { pid } = JSON.parse(readFileSync(path.join(servers, name), 'utf8')) as { pid: number }
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }
  await client?.close()
  if (work) rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!binary || !bundle)('mdrender MCP server', () => {
  it('advertises the tool set', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)
    for (const name of ALL_TOOLS) expect(names).toContain(name)
    // Every tool tells the agent what it does.
    expect(tools.every((tool) => (tool.description ?? '').length > 40)).toBe(true)
  })

  it('reports no servers before one is started and explains what to do', async () => {
    const data = await expectOk('list_servers')
    expect(data.servers).toEqual([])

    const result = await call('list_tabs')
    expect(result.ok).toBe(false)
    expect(result.text).toContain('no md-render server is running')
    expect(result.text).toContain('start_server')
  })

  it('start_server brings a server up and returns workspace URLs', async () => {
    const data = await expectOk('start_server', { paths: [notes, docs], port: portA })
    expect(data.port).toBe(portA)
    expect(data.attached).toBe(false)
    expect(data.url).toBe(`http://127.0.0.1:${portA}`)
    const workspaces = data.workspaces as Array<{ name: string; url: string; documents: number }>
    expect(workspaces.map((ws) => ws.name)).toEqual(['project', 'docs'])
    expect(workspaces[1].url).toBe(`http://127.0.0.1:${portA}/docs/`)
    expect(workspaces[1].documents).toBe(2)

    // The server is real: its page answers.
    const response = await fetch(`${data.url}/docs/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('__MD_RENDER_SERVER__')
  }, 30_000)

  it('list_servers shows the live server with its workspaces', async () => {
    const data = await expectOk('list_servers')
    const servers = data.servers as Array<{ port: number; alive: boolean; pid: number; workspaces: Array<{ name: string }> }>
    expect(servers).toHaveLength(1)
    expect(servers[0].port).toBe(portA)
    expect(servers[0].alive).toBe(true)
    expect(servers[0].pid).toBeGreaterThan(0)
    expect(servers[0].workspaces.map((ws) => ws.name)).toEqual(['project', 'docs'])
  })

  it('start_server on a port that already holds md-render attaches instead of failing', async () => {
    const extra = path.join(work, 'extra')
    mkdirSync(extra)
    writeFileSync(path.join(extra, 'extra.md'), '# Extra\n')

    const data = await expectOk('start_server', { paths: [extra], port: portA })
    expect(data.attached).toBe(true)
    expect(data.added).toEqual(['extra.md'])
    const workspaces = data.workspaces as Array<{ name: string }>
    expect(workspaces.map((ws) => ws.name)).toContain('extra')
  }, 30_000)

  it('open_directory creates a workspace and returns its tabs with URLs', async () => {
    const second = path.join(work, 'second')
    mkdirSync(second)
    writeFileSync(path.join(second, 'one.md'), '# One\n')
    writeFileSync(path.join(second, 'two.md'), '# Two\n')

    const data = await expectOk('open_directory', { path: second })
    expect(data.workspace).toBe('second')
    expect(data.url).toBe(`http://127.0.0.1:${portA}/second/`)
    const tabs = data.tabs as Array<{ label: string; url: string; id: number; workspace: string }>
    expect(tabs.map((tab) => tab.label)).toEqual(['one.md', 'two.md'])
    expect(tabs[0].url).toBe(`http://127.0.0.1:${portA}/second/?doc=${tabs[0].id}`)

    // A directory already served just reports itself.
    const again = await expectOk('open_directory', { path: second })
    expect(again.workspace).toBe('second')
    expect(again.added).toEqual([])

    const notDir = await call('open_directory', { path: notes })
    expect(notDir.ok).toBe(false)
    expect(notDir.text).toContain('open_tab')
  })

  it('list_tabs across workspaces names each tab\'s workspace', async () => {
    const data = await expectOk('list_tabs')
    const tabs = data.tabs as Array<{ label: string; workspace: string; url: string }>
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab.workspace]))
    expect(byLabel['notes.md']).toBe('project')
    expect(byLabel['guide/setup.md']).toBe('docs')
    expect(byLabel['one.md']).toBe('second')
    expect(tabs.every((tab) => tab.url.startsWith(`http://127.0.0.1:${portA}/${tab.workspace}/?doc=`))).toBe(true)

    const scoped = await expectOk('list_tabs', { workspace: 'docs' })
    expect((scoped.tabs as Array<{ label: string }>).map((tab) => tab.label)).toEqual([
      'api.md',
      'guide/setup.md',
    ])

    const unknown = await call('list_tabs', { workspace: 'nowhere' })
    expect(unknown.ok).toBe(false)
    expect(unknown.text).toContain('no workspace named')
  })

  it('read_document by path returns content and the browser URL', async () => {
    const data = await expectOk('read_document', { path: notes })
    expect(data.content).toContain('The quick brown fox.')
    expect(data.workspace).toBe('project')
    expect(data.url).toBe(`http://127.0.0.1:${portA}/project/?doc=${data.id}`)

    const byId = await expectOk('read_document', { id: data.id })
    expect(byId.path).toBe(notes)

    const closed = await call('read_document', { path: path.join(work, 'nowhere.md') })
    expect(closed.ok).toBe(false)
    expect(closed.text).toContain('not an open tab')
  })

  it('write_document saves to disk', async () => {
    const data = await expectOk('write_document', {
      path: notes,
      content: '# Notes\n\nThe quick brown fox.\n\nRewritten paragraph.\n',
    })
    expect(data.written).toBe(true)
    expect(readFileSync(notes, 'utf8')).toContain('Rewritten paragraph.')

    // Only open tabs can be written, even with the token in hand.
    const outsider = path.join(work, 'outsider.md')
    writeFileSync(outsider, '# untouched\n')
    const refused = await call('write_document', { path: outsider, content: '# hijacked\n' })
    expect(refused.ok).toBe(false)
    expect(readFileSync(outsider, 'utf8')).toBe('# untouched\n')
  })

  it('add_comment anchors after the passage and reports when it could not', async () => {
    const anchored = await expectOk('add_comment', {
      path: notes,
      passage: 'quick brown fox',
      comment: 'Needs a <citation>',
    })
    expect(anchored.anchored).toBe(true)
    const onDisk = readFileSync(notes, 'utf8')
    expect(onDisk).toContain('quick brown fox\n<chat><comment>Needs a &lt;citation&gt;</comment></chat>\n')

    const orphan = await expectOk('add_comment', {
      path: notes,
      passage: 'text that is not there',
      comment: 'orphan',
    })
    expect(orphan.anchored).toBe(false)
    expect(readFileSync(notes, 'utf8')).toContain('> Comment target: text that is not there')
  })

  it('export_clean writes NAME.clean.md without chat blocks', async () => {
    const data = await expectOk('export_clean', { path: notes })
    expect(data.outputPath).toBe(path.join(project, 'notes.clean.md'))
    const clean = readFileSync(data.outputPath as string, 'utf8')
    expect(clean).not.toContain('<chat>')
    expect(clean).toContain('quick brown fox')
    // The source keeps its comments.
    expect(readFileSync(notes, 'utf8')).toContain('<chat>')
  })

  it('open_tab keeps a nested file inside its workspace with a relative label', async () => {
    const before = await expectOk('list_tabs', { workspace: 'docs' })
    const nested = (before.tabs as Array<{ id: number; label: string }>).find(
      (tab) => tab.label === 'guide/setup.md',
    )!
    await expectOk('close_tab', { id: nested.id })

    // No workspace given: the most specific one containing the file wins,
    // and the label is relative to it — no "guide" workspace appears.
    const reopened = await expectOk('open_tab', { path: setup })
    expect(reopened.workspace).toBe('docs')
    expect(reopened.label).toBe('guide/setup.md')
    expect(reopened.alreadyOpen).toBe(false)
    expect(reopened.id).not.toBe(nested.id)
    expect(reopened.url).toBe(`http://127.0.0.1:${portA}/docs/?doc=${reopened.id}`)

    const again = await expectOk('open_tab', { path: setup })
    expect(again.alreadyOpen).toBe(true)
    expect(again.id).toBe(reopened.id)

    const workspaces = await expectOk('list_workspaces')
    expect((workspaces.workspaces as Array<{ name: string }>).map((ws) => ws.name)).not.toContain('guide')

    const missing = await call('open_tab', { path: path.join(work, 'missing.md') })
    expect(missing.ok).toBe(false)
    expect(missing.text).toContain('cannot read')
  })

  it('close_tab tombstones the file and refresh does not bring it back', async () => {
    const closed = await expectOk('close_tab', { path: api })
    expect((closed.closed as { label: string }).label).toBe('api.md')
    expect((closed.remaining as Array<{ label: string }>).map((tab) => tab.label)).not.toContain('api.md')

    writeFileSync(path.join(docs, 'appeared.md'), '# Appeared\n')
    const refreshed = await expectOk('refresh', { workspace: 'docs' })
    const labels = (refreshed.tabs as Array<{ label: string }>).map((tab) => tab.label)
    expect(labels).toContain('appeared.md')
    expect(labels).not.toContain('api.md')

    const gone = await call('close_tab', { id: 9999 })
    expect(gone.ok).toBe(false)
    expect(gone.text).toContain('list_tabs')
  })

  it('focus_tab and set_theme bump the workspace view state', async () => {
    const focused = await expectOk('focus_tab', { path: notes })
    expect(focused.workspace).toBe('project')
    expect(focused.seq).toBe(1)
    expect(focused.url).toBe(`http://127.0.0.1:${portA}/project/?doc=${focused.doc}`)

    const themed = await expectOk('set_theme', { theme: 'nocturne', workspace: 'project' })
    expect(themed.seq).toBe(2)

    // What the page will poll, checked over plain HTTP.
    const view = await (await fetch(`http://127.0.0.1:${portA}/api/view?ws=project`)).json()
    expect(view).toEqual({ doc: focused.doc, theme: 'nocturne', seq: 2 })

    // Several workspaces: set_theme needs to be told which.
    const ambiguous = await call('set_theme', { theme: 'forest' })
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.text).toContain('pass workspace')
  })

  it('set_theme rejects an unknown theme id', async () => {
    const result = await call('set_theme', { theme: 'neon', workspace: 'project' })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('nocturne')
    expect(result.text).toContain('warm-paper')
  })

  it('close_workspace removes it and frees the name', async () => {
    const data = await expectOk('close_workspace', { workspace: 'second' })
    expect(data.closed).toBe('second')
    expect((data.remaining as Array<{ name: string }>).map((ws) => ws.name)).not.toContain('second')
    expect((await fetch(`http://127.0.0.1:${portA}/second/`)).status).toBe(404)

    const reopened = await expectOk('open_directory', { path: path.join(work, 'second') })
    expect(reopened.workspace).toBe('second')

    const unknown = await call('close_workspace', { workspace: 'nowhere' })
    expect(unknown.ok).toBe(false)
  })

  it('infers the port when exactly one server is live', async () => {
    const data = await expectOk('list_workspaces')
    expect(data.port).toBe(portA)
  })

  it('refuses to guess between two live servers and lists their ports', async () => {
    const lone = path.join(work, 'lone.md')
    writeFileSync(lone, '# Lone\n')
    const second = await expectOk('start_server', { paths: [lone], port: portB })
    expect(second.attached).toBe(false)

    const result = await call('list_tabs')
    expect(result.ok).toBe(false)
    expect(result.text).toContain(String(portA))
    expect(result.text).toContain(String(portB))
    expect(result.text).toContain('pass port')

    const explicit = await expectOk('list_tabs', { port: portB })
    expect((explicit.tabs as Array<{ label: string }>).map((tab) => tab.label)).toEqual(['lone.md'])

    const dead = await call('list_tabs', { port: 1 })
    expect(dead.ok).toBe(false)
    expect(dead.text).toContain('no md-render server is answering on port 1')
  }, 30_000)

  it('stop_server shuts the server down and clears its state file', async () => {
    const record = path.join(stateDir, 'md-render', 'servers', `${portB}.json`)
    expect(existsSync(record)).toBe(true)

    const data = await expectOk('stop_server', { port: portB })
    expect(data.stopped).toBe(true)
    expect(existsSync(record)).toBe(false)
    await expect(fetch(`http://127.0.0.1:${portB}/api/health`)).rejects.toThrow()

    const servers = (await expectOk('list_servers')).servers as Array<{ port: number }>
    expect(servers.map((server) => server.port)).toEqual([portA])
  }, 20_000)

  it('document tools fail with a next-step hint once no server is running', async () => {
    await expectOk('stop_server', { port: portA })

    const result = await call('read_document', { path: notes })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('no md-render server is running')
    expect(result.text).toContain('start_server')
    expect((await expectOk('list_servers')).servers).toEqual([])
  }, 20_000)
})
