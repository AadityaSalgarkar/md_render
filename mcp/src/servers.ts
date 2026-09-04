/**
 * Finding, starting and stopping `md-render --port` servers.
 *
 * A running server records `{port, token, pid}` in
 * `$XDG_STATE_HOME/md-render/servers/<port>.json` (falling back to
 * `~/.local/state`), mode 0600. That file is how out-of-process tooling
 * learns the token every mutation needs.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MdRenderClient,
  ToolError,
  baseUrl,
  isRemote,
  workspaceUrl,
  type WorkspaceEntry,
} from './client.ts'

export interface ServerRecord {
  port: number
  token: string
  pid: number
}

export type Probe = 'md-render' | 'occupied' | 'free'

export interface WorkspaceSummary extends WorkspaceEntry {
  url: string
}

export interface ServerInfo {
  port: number
  pid: number
  alive: boolean
  url: string
  workspaces: WorkspaceSummary[]
  note?: string
}

export interface LiveServer {
  port: number
  record: ServerRecord
  client: MdRenderClient
}

export const DEFAULT_PORT = 9999
export const PORT_SCAN_ATTEMPTS = 50

export function stateDir(): string {
  const xdg = process.env.XDG_STATE_HOME
  const base = xdg && xdg.length > 0 ? xdg : path.join(homedir(), '.local', 'state')
  return path.join(base, 'md-render', 'servers')
}

function recordPath(port: number): string {
  return path.join(stateDir(), `${port}.json`)
}

export function readRecord(port: number): ServerRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(recordPath(port), 'utf8')) as Partial<ServerRecord>
    if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') return null
    return { port: parsed.port, token: parsed.token, pid: Number(parsed.pid ?? 0) }
  } catch {
    return null
  }
}

export function readRecords(): ServerRecord[] {
  let names: string[]
  try {
    names = readdirSync(stateDir())
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readRecord(Number(name.slice(0, -'.json'.length))))
    .filter((record): record is ServerRecord => record !== null)
    .sort((a, b) => a.port - b.port)
}

export async function probe(port: number, timeoutMs = 1000): Promise<Probe> {
  try {
    const response = await fetch(`${baseUrl(port)}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return 'occupied'
    const body = (await response.json()) as { app?: string }
    return body.app === 'md-render' ? 'md-render' : 'occupied'
  } catch {
    return 'free'
  }
}

export function pidAlive(pid: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function summariseWorkspaces(port: number, workspaces: WorkspaceEntry[]): WorkspaceSummary[] {
  return workspaces.map((ws) => ({ ...ws, url: workspaceUrl(port, ws.name) }))
}

/**
 * Every server the state directory knows about. A record whose server does
 * not answer and whose process is gone is a leftover from a kill; it is
 * removed and reported once so the listing stays honest.
 */
export async function listServers(): Promise<ServerInfo[]> {
  const servers: ServerInfo[] = []
  for (const record of readRecords()) {
    const alive = (await probe(record.port)) === 'md-render'
    const info: ServerInfo = {
      port: record.port,
      pid: record.pid,
      alive,
      url: baseUrl(record.port),
      workspaces: [],
    }
    if (alive) {
      try {
        const client = new MdRenderClient(record.port, record.token)
        info.workspaces = summariseWorkspaces(record.port, await client.workspaces())
      } catch (err) {
        info.note = (err as Error).message
      }
    } else if (!pidAlive(record.pid)) {
      rmSync(recordPath(record.port), { force: true })
      info.note = 'stale record from a server that is no longer running; removed'
    } else {
      info.note = 'the process is alive but the port is not answering'
    }
    servers.push(info)
  }
  return servers
}

/**
 * The server a tool should talk to. An explicit port must hold a live
 * md-render with a readable record. Without one: exactly one live server is
 * used; none or several is an error that says what to do next.
 */
export async function resolveServer(explicit?: number): Promise<LiveServer> {
  if (explicit !== undefined) {
    if ((await probe(explicit)) !== 'md-render') {
      throw new ToolError(
        `no md-render server is answering on port ${explicit}; call list_servers, or start_server with the paths to serve`,
      )
    }
    const record = readRecord(explicit)
    if (!record) {
      throw new ToolError(
        `an md-render server is on port ${explicit} but its token could not be read from ${recordPath(explicit)}; it may have been started by another user`,
      )
    }
    return { port: explicit, record, client: new MdRenderClient(explicit, record.token) }
  }

  const live = (await listServers()).filter((server) => server.alive)
  if (live.length === 0) {
    throw new ToolError('no md-render server is running; call start_server with the paths to serve')
  }
  if (live.length > 1) {
    throw new ToolError(
      `several md-render servers are running (ports ${live.map((s) => s.port).join(', ')}); pass port`,
    )
  }
  return resolveServer(live[0].port)
}

/** The repository this bundle was built in, if it still exists around it. */
function repoRoot(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // mcp/dist/index.js -> repo, or mcp/src/servers.ts -> repo.
  const candidate = path.resolve(here, '..', '..')
  return existsSync(path.join(candidate, 'src-tauri')) ? candidate : null
}

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

/** Where the md-render binary is, checked in the order a user would expect. */
export function findBinary(): string {
  const candidates: Array<string | null> = [
    process.env.MDRENDER_BIN ?? null,
    '/Applications/MD_RENDER.app/Contents/MacOS/md-render',
    onPath('md-render'),
    path.join(homedir(), '.local', 'bin', 'md-render'),
  ]
  const repo = repoRoot()
  if (repo) {
    candidates.push(
      path.join(repo, 'src-tauri', 'target', 'release', 'md-render'),
      path.join(repo, 'src-tauri', 'target', 'debug', 'app'),
    )
  }
  candidates.push(onPath('mdrender'))

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  throw new ToolError(
    'md-render is not installed: set MDRENDER_BIN, or install it with `curl -fsSL https://aadityasalgarkar.github.io/md_render/install.sh | sh`',
  )
}

/** First port from `start` that is free or already an md-render server. */
export async function pickPort(start = DEFAULT_PORT, attempts = PORT_SCAN_ATTEMPTS): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = start + offset
    if (candidate > 65535) break
    if ((await probe(candidate)) !== 'occupied') return candidate
  }
  throw new ToolError(
    `no usable port between ${start} and ${start + attempts - 1}; pass port to pick one explicitly`,
  )
}

export interface StartResult {
  port: number
  pid: number
  url: string
  attached: boolean
  binary: string
  workspaces: WorkspaceSummary[]
  added: string[]
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, stepMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
  return false
}

/**
 * Serve `paths`. When an md-render server already holds the chosen port the
 * paths are handed to it instead, the same as re-running `mdrender --port`.
 */
export async function startServer(options: {
  paths: string[]
  port?: number
  host?: string
}): Promise<StartResult> {
  // URLs go through as they are; the server downloads them.
  const paths = options.paths.map((raw) => (isRemote(raw) ? raw : path.resolve(raw)))
  for (const candidate of paths) {
    if (!isRemote(candidate) && !existsSync(candidate)) {
      throw new ToolError(`cannot read '${candidate}'`)
    }
  }

  const port = options.port ?? (await pickPort())
  const state = await probe(port)
  if (state === 'occupied') {
    throw new ToolError(`port ${port} is in use by another program; pass a different port`)
  }

  if (state === 'md-render') {
    const live = await resolveServer(port)
    const result = await live.client.addDocuments(paths)
    return {
      port,
      pid: live.record.pid,
      url: baseUrl(port),
      attached: true,
      binary: '',
      workspaces: summariseWorkspaces(port, await live.client.workspaces()),
      added: result.added,
    }
  }

  const binary = findBinary()
  const args = ['--port', String(port)]
  if (options.host) args.push('--host', options.host)
  args.push(...paths)

  // The server outlives this process, so it is detached; its stderr goes to
  // a file so a refusal (an unreadable path, a bad host) can be reported.
  const logDir = path.join(tmpdir(), 'md-render-mcp')
  mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, `${port}.log`)
  const log = openSync(logPath, 'w')
  const child = spawn(binary, args, { detached: true, stdio: ['ignore', log, log] })
  let exited: number | null = null
  child.once('exit', (code) => {
    exited = code ?? -1
  })
  child.unref()

  const up = await waitFor(async () => exited !== null || (await probe(port)) === 'md-render', 15_000)
  if (exited !== null || !up) {
    let output = ''
    try {
      output = readFileSync(logPath, 'utf8').trim()
    } catch {
      // nothing captured
    }
    throw new ToolError(
      exited !== null
        ? `md-render exited with status ${exited}: ${output || 'no output'}`
        : `md-render did not come up on port ${port} within 15 seconds: ${output || 'no output'}`,
    )
  }

  // The record is written just before serving starts; give it a moment.
  let record: ServerRecord | null = null
  await waitFor(async () => (record = readRecord(port)) !== null, 5_000)
  if (!record) {
    throw new ToolError(
      `md-render is serving on port ${port} but wrote no record under ${stateDir()}; mutations will not be possible`,
    )
  }
  const live: ServerRecord = record
  const client = new MdRenderClient(port, live.token)
  const workspaces = summariseWorkspaces(port, await client.workspaces())
  return {
    port,
    pid: live.pid,
    url: baseUrl(port),
    attached: false,
    binary,
    workspaces,
    added: [],
  }
}

/** Ask the server to stop; fall back to a signal if it does not. */
export async function stopServer(port: number): Promise<{ port: number; stopped: true; method: string }> {
  const live = await resolveServer(port)
  let method = 'shutdown request'
  try {
    await live.client.shutdown()
  } catch (err) {
    method = `signal (shutdown request failed: ${(err as Error).message})`
  }

  let gone = await waitFor(async () => (await probe(port)) === 'free', 5_000)
  if (!gone && pidAlive(live.record.pid)) {
    process.kill(live.record.pid, 'SIGTERM')
    method = 'SIGTERM'
    gone = await waitFor(async () => (await probe(port)) === 'free', 5_000)
  }
  if (!gone) {
    throw new ToolError(`the server on port ${port} (pid ${live.record.pid}) did not stop`)
  }
  // A signalled process leaves its record behind; a clean shutdown removes it.
  if (!pidAlive(live.record.pid)) rmSync(recordPath(port), { force: true })
  return { port, stopped: true, method }
}
