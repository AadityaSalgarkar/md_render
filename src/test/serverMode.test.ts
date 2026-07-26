import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
}, 40_000)

afterAll(() => {
  server?.kill('SIGTERM')
  if (work) rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!binary)('md-render --port', () => {
  it('serves the SPA with the marker that puts the frontend into server mode', async () => {
    const html = await (await fetch(`${origin}/`)).text()

    // Without this the app would start in desktop mode and try Tauri calls.
    expect(html).toContain('__MD_RENDER_SERVER__')
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

  it('reports itself as read-only and refuses writes', async () => {
    const backend = serverBackend(origin)

    expect(backend.mode).toBe('server')
    expect(backend.writable).toBe(false)
    await expect(backend.writeFile(firstDoc, 'nope')).rejects.toThrow()
    await expect(backend.exportMarkdown(firstDoc, 'nope')).rejects.toThrow()
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
})
