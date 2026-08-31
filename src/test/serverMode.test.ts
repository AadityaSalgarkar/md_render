import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serverBackend } from '../lib/backend'

// Drives the real `md-render --port` process over real HTTP. Nothing is stubbed:
// if the binary is not built, the suite says so rather than pretending to pass.
const REPO = path.resolve(__dirname, '../..')
const CANDIDATES = [
  path.join(REPO, 'src-tauri/target/debug/app'),
  path.join(REPO, 'src-tauri/target/release/md-render'),
  path.join(REPO, 'src-tauri/target/release/app'),
]

const binary = CANDIDATES.find((candidate) => existsSync(candidate))

let work: string
let server: ChildProcess | undefined
let origin: string
let port: number
let firstDoc: string
let secondDoc: string
let image: string

/** Ports are picked high and random-ish to avoid collisions between runs. */
function pickPort(): number {
  return 30000 + Math.floor(Math.random() * 20000)
}

/** The token the server injected into the page it serves. */
let injectedToken = ''
const token = () => injectedToken

async function readInjectedToken(url: string): Promise<string> {
  // The marker lives on workspace pages; the root only redirects or lists.
  const workspaces = (await (await fetch(`${url}/api/workspaces`)).json()) as Array<{
    name: string
  }>
  const page = workspaces[0] ? `${url}/${workspaces[0].name}/` : `${url}/`
  const html = await (await fetch(page)).text()
  return html.match(/__MD_RENDER_TOKEN__=("(?:[^"\\]|\\.)*")/)?.[1]
    ? (JSON.parse(html.match(/__MD_RENDER_TOKEN__=("(?:[^"\\]|\\.)*")/)![1]) as string)
    : ''
}

async function waitForServer(url: string, attempts = 100): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) {
        const body = (await response.json()) as { app?: string }
        if (body.app === 'md-render') return true
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

beforeAll(async () => {
  if (!binary) return

  work = realpathSync(mkdtempSync(path.join(tmpdir(), 'md-render-serve-')))
  firstDoc = path.join(work, 'first.md')
  secondDoc = path.join(work, 'second.md')
  image = path.join(work, 'picture.png')
  writeFileSync(firstDoc, '# First document\n\nServed over HTTP.\n')
  writeFileSync(secondDoc, '# Second document\n')
  // Minimal PNG header is enough; the server only needs to read bytes back.
  writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

  const nested = path.join(work, 'nested')
  mkdirSync(nested)
  writeFileSync(path.join(nested, 'third.md'), '# Third document\n')

  port = pickPort()
  origin = `http://127.0.0.1:${port}`

  // One explicit file plus a directory, exercising both argument kinds.
  server = spawn(binary, ['--port', String(port), firstDoc, nested], {
    stdio: 'ignore',
    env: { ...process.env, XDG_STATE_HOME: path.join(work, 'state') },
  })

  const ready = await waitForServer(origin)
  if (!ready) throw new Error('md-render server did not come up')

  injectedToken = await readInjectedToken(origin)
  if (!injectedToken) throw new Error('server did not inject a token')
}, 40_000)

afterAll(() => {
  server?.kill('SIGTERM')
  if (work) rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!binary)('md-render --port', () => {
  it('serves the SPA with the marker that puts the frontend into server mode', async () => {
    const html = await (await fetch(`${origin}/nested/`)).text()

    // Without this the app would start in desktop mode and try Tauri calls.
    expect(html).toContain('__MD_RENDER_SERVER__')
    // And the token the page needs in order to save.
    expect(html).toContain('__MD_RENDER_TOKEN__')
    // Plus the workspace this page is scoped to.
    expect(html).toContain('__MD_RENDER_WORKSPACE__')
  })

  it('lists an explicit file and the markdown found under a directory', async () => {
    const backend = serverBackend(origin)
    const documents = await backend.listDocuments()
    const labels = documents.map((doc) => doc.label)

    expect(labels).toContain('first.md')
    expect(labels).toContain('third.md')
  })

  it('reads a document by id through the backend layer', async () => {
    const backend = serverBackend(origin)
    const [first] = await backend.listDocuments()
    const document = await backend.readDocument(first.id)

    expect(document.content).toContain('Served over HTTP.')
    expect(document.baseDir).toBe(work)
    expect(document.path).toBe(firstDoc)
  })

  it('reports the same capabilities as the desktop app', async () => {
    const backend = serverBackend(origin)

    expect(backend.mode).toBe('server')
    expect(backend.writable).toBe(true)
  })

  it('saves an open document back to disk', async () => {
    // The token the server injects into the page; supplied here the same way
    // the browser would.
    ;(globalThis as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ = token()
    const backend = serverBackend(origin)

    await backend.writeFile(firstDoc, '# Edited through the browser\n')

    expect(readFileSync(firstDoc, 'utf8')).toContain('Edited through the browser')
    // And reading it back through the backend agrees with disk.
    expect(await backend.readFile(firstDoc)).toContain('Edited through the browser')
  })

  it('exports the clean copy beside the document', async () => {
    ;(globalThis as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ = token()
    const backend = serverBackend(origin)

    const output = await backend.exportMarkdown(firstDoc, '# Clean copy\n')

    expect(output).toContain('first.clean.md')
    expect(readFileSync(output, 'utf8')).toContain('Clean copy')
  })

  it('refuses to save without the injected token', async () => {
    ;(globalThis as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ = 'wrong-token'
    const backend = serverBackend(origin)
    const before = readFileSync(firstDoc, 'utf8')

    await expect(backend.writeFile(firstDoc, '# forged\n')).rejects.toThrow()
    expect(readFileSync(firstDoc, 'utf8')).toBe(before)
  })

  it('refuses to touch a file that is not one of the open documents', async () => {
    ;(globalThis as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ = token()
    const backend = serverBackend(origin)
    const outsider = path.join(work, 'not-open.md')
    writeFileSync(outsider, '# untouched\n')

    await expect(backend.writeFile(outsider, '# hijacked\n')).rejects.toThrow()
    expect(readFileSync(outsider, 'utf8')).toBe('# untouched\n')
  })

  it('serves an image beside the document', async () => {
    const backend = serverBackend(origin)
    const response = await fetch(backend.assetUrl(image))

    expect(response.status).toBe(200)
  })

  it('refuses to serve files outside the served directories', async () => {
    const response = await fetch(`${origin}/api/asset?path=${encodeURIComponent('/etc/passwd')}`)

    expect([403, 404]).toContain(response.status)
  })

  it('refuses to add documents without the token', async () => {
    const response = await fetch(`${origin}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [secondDoc] }),
    })

    expect(response.status).toBe(401)
  })

  it('picks up a document added to a served directory when refreshed', async () => {
    const backend = serverBackend(origin)
    const before = await backend.listDocuments()
    expect(before.map((doc) => doc.label)).not.toContain('appeared-later.md')

    // Something writes a new file into the directory the server is serving.
    writeFileSync(path.join(work, 'nested', 'appeared-later.md'), '# Appeared later\n')

    // A plain list does not rescan, so the periodic poll stays cheap.
    expect((await backend.listDocuments()).map((doc) => doc.label)).not.toContain(
      'appeared-later.md',
    )

    // The refresh control does.
    const after = await backend.refreshDocuments()
    expect(after.map((doc) => doc.label)).toContain('appeared-later.md')
  })

  it('adds a tab when the same command is run again against a live server', async () => {
    const before = await serverBackend(origin).listDocuments()
    expect(before.map((doc) => doc.label)).not.toContain('second.md')

    // Exactly what a user would type a second time. It must attach to the
    // running server instead of failing to bind the port.
    const output = execFileSync(binary!, ['--port', String(port), secondDoc], {
      encoding: 'utf8',
      env: { ...process.env, XDG_STATE_HOME: path.join(work, 'state') },
      timeout: 20_000,
    })

    expect(output).toContain('second.md')

    const after = await serverBackend(origin).listDocuments()
    expect(after.map((doc) => doc.label)).toContain('second.md')

    // And the newly added tab is readable.
    const added = after.find((doc) => doc.label === 'second.md')!
    const document = await serverBackend(origin).readDocument(added.id)
    expect(document.content).toContain('Second document')
  }, 30_000)

  it('refuses to close a tab without the token', async () => {
    const documents = await serverBackend(origin).listDocuments()
    const target = documents.find((doc) => doc.label === 'second.md')!

    const response = await fetch(`${origin}/api/file?id=${target.id}`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(401)

    const after = await serverBackend(origin).listDocuments()
    expect(after.map((doc) => doc.label)).toContain('second.md')
  })

  it('closes a tab without renumbering the others, and a refresh does not bring it back', async () => {
    ;(globalThis as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ = token()
    const backend = serverBackend(origin)

    const before = await backend.listDocuments()
    const doomed = before.find((doc) => doc.label === 'appeared-later.md')!
    const kept = before.find((doc) => doc.label === 'third.md')!

    const after = await backend.closeDocument(doomed.id)
    expect(after.map((doc) => doc.label)).not.toContain('appeared-later.md')
    // The surviving tabs keep the exact ids the browser already holds.
    expect(after.find((doc) => doc.label === 'third.md')!.id).toBe(kept.id)
    const document = await backend.readDocument(kept.id)
    expect(document.content).toContain('Third document')

    // The closed document cannot be written any more, even with the token.
    await expect(backend.writeFile(doomed.path, '# necromancy\n')).rejects.toThrow()

    // A refresh rescans the directory the file still sits in, but the closed
    // tab stays closed.
    const refreshed = await backend.refreshDocuments()
    expect(refreshed.map((doc) => doc.label)).not.toContain('appeared-later.md')
  })

  it('re-opens a closed tab when the file is explicitly added again', async () => {
    ;(globalThis as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ = token()
    const backend = serverBackend(origin)

    const before = await backend.listDocuments()
    const doomed = before.find((doc) => doc.label === 'second.md')!
    const closed = await backend.closeDocument(doomed.id)
    expect(closed.map((doc) => doc.label)).not.toContain('second.md')

    // Exactly what a user would type to open it again.
    const output = execFileSync(binary!, ['--port', String(port), secondDoc], {
      encoding: 'utf8',
      env: { ...process.env, XDG_STATE_HOME: path.join(work, 'state') },
      timeout: 20_000,
    })
    // The attach output tells the user where to look.
    expect(output).toContain('open: http://')

    const after = await backend.listDocuments()
    const reopened = after.find((doc) => doc.label === 'second.md')
    expect(reopened).toBeDefined()
    // Under a fresh id — ids are never recycled.
    expect(reopened!.id).not.toBe(doomed.id)

    const document = await backend.readDocument(reopened!.id)
    expect(document.content).toContain('Second document')
  }, 30_000)

  it('serves each directory as its own workspace URL', async () => {
    const response = await fetch(`${origin}/api/workspaces`)
    expect(response.status).toBe(200)
    const workspaces = (await response.json()) as Array<{ name: string; documents: number }>
    expect(workspaces).toHaveLength(2)
    expect(workspaces.map((ws) => ws.name)).toContain('nested')

    // The workspace page is scoped by name.
    const html = await (await fetch(`${origin}/nested/`)).text()
    expect(html).toContain('"nested"')
  })

  it('scopes the tab list to the workspace the page belongs to', async () => {
    ;(globalThis as { __MD_RENDER_WORKSPACE__?: string }).__MD_RENDER_WORKSPACE__ = 'nested'
    try {
      const labels = (await serverBackend(origin).listDocuments()).map((doc) => doc.label)
      expect(labels).toContain('third.md')
      expect(labels).not.toContain('first.md')
    } finally {
      delete (globalThis as { __MD_RENDER_WORKSPACE__?: string }).__MD_RENDER_WORKSPACE__
    }
  })

  it('lists the workspaces at the root when several are served', async () => {
    const response = await fetch(`${origin}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('/nested/')
  })

  it('rejects an unknown workspace path', async () => {
    const response = await fetch(`${origin}/definitely-not-a-workspace/`)
    expect(response.status).toBe(404)
  })
})
