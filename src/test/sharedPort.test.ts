// @vitest-environment node
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pickPort } from '../../mcp/src/servers'

// A shared login node: another user's md-render holds a port. Its token lives
// in their state directory, not ours, so neither the binary nor the MCP server
// may pick that port. "Another user" is a real server started with a
// different XDG_STATE_HOME. Nothing is stubbed.
const REPO = path.resolve(__dirname, '../..')
const binary = [
  path.join(REPO, 'src-tauri/target/debug/app'),
  path.join(REPO, 'src-tauri/target/release/md-render'),
  path.join(REPO, 'src-tauri/target/release/app'),
].find((candidate) => existsSync(candidate))

let work: string
let theirs: string
let ours: string
let other: ChildProcess | undefined
const port = 30000 + Math.floor(Math.random() * 20000)
const savedState = process.env.XDG_STATE_HOME

async function healthy(url: string): Promise<boolean> {
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
  work = realpathSync(mkdtempSync(path.join(tmpdir(), 'md-render-shared-')))
  theirs = path.join(work, 'their-state')
  ours = path.join(work, 'our-state')
  mkdirSync(path.join(work, 'docs'))
  writeFileSync(path.join(work, 'docs', 'note.md'), '# Note\n')
  other = spawn(binary, ['--port', String(port), path.join(work, 'docs')], {
    env: { ...process.env, XDG_STATE_HOME: theirs, MDRENDER_BROWSER: '' },
    stdio: 'ignore',
  })
  expect(await healthy(`http://127.0.0.1:${port}`)).toBe(true)
}, 30_000)

afterAll(() => {
  other?.kill('SIGTERM')
  if (savedState === undefined) delete process.env.XDG_STATE_HOME
  else process.env.XDG_STATE_HOME = savedState
  if (work) rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!binary)('another user on the same port', () => {
  it('md-render --port names the server as not ours and offers a free port', async () => {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      execFile(
        binary!,
        ['--port', String(port), path.join(work, 'docs', 'note.md')],
        { env: { ...process.env, XDG_STATE_HOME: ours } },
        (error, _stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, stderr }),
      )
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(`port ${port} is not ours`)
    expect(result.stderr).toMatch(new RegExp(`port ${port + 1}|port \\d+ is free`))
  })

  it("the MCP server's pickPort skips it, and joins it with its token", async () => {
    process.env.XDG_STATE_HOME = ours
    expect(await pickPort(port, 5)).toBeGreaterThan(port)
    process.env.XDG_STATE_HOME = theirs
    expect(await pickPort(port, 5)).toBe(port)
  })
})
