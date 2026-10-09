import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { dirname } from './resolveImageSrc'
import {
  ExperimentsError,
  type DbSource,
  type ExperimentsApi,
  type ProjectsResponse,
  type RunsResponse,
  type SeriesResponse,
} from './plots/types'

/** One open document — a tab. */
export interface DocumentMeta {
  id: string
  label: string
  path: string
}

export interface DocumentBody extends DocumentMeta {
  baseDir: string
  content: string
}

/**
 * What the server would like this workspace's pages to show: a tab to focus
 * and a theme to wear, set by tooling outside the browser. `seq` climbs on
 * every change so the page applies each command once.
 */
export interface ViewState {
  doc: string | null
  theme: string | null
  seq: number
}

/**
 * Where the app is running:
 * - `desktop` — the Tauri shell, with filesystem access. Also the fallback in a
 *   plain browser, where the Tauri calls simply fail and the app drops back to
 *   the draft held in localStorage.
 * - `server`  — a browser talking to `md-render --port`, with the same
 *   capabilities as the desktop app.
 */
export type BackendMode = 'desktop' | 'server'

export interface Backend {
  mode: BackendMode
  /** Whether the UI may offer editing and saving. */
  writable: boolean
  listDocuments(): Promise<DocumentMeta[]>
  /** Rescan the original path arguments, picking up documents added since. */
  refreshDocuments(): Promise<DocumentMeta[]>
  /** Close a tab; resolves to the updated document list. */
  closeDocument(id: string): Promise<DocumentMeta[]>
  readDocument(id: string): Promise<DocumentBody>
  /** Turn an absolute image path into something the page can load. */
  assetUrl(path: string): string
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  exportMarkdown(path: string, content: string): Promise<string>
  getLaunchFile(): Promise<string | null>
  /** The view the server is asking for; `null` where nothing can ask. */
  getViewState(): Promise<ViewState | null>
  /** Read-only access to trackio experiment databases, for `<plot>` blocks. */
  experiments: ExperimentsApi
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Token the server injected into the page; required for anything that writes. */
function serverToken(): string {
  if (typeof window === 'undefined') return ''
  return (window as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ ?? ''
}

/**
 * Workspace this page is scoped to, injected by the server alongside the
 * token. Empty when absent (older pages, tests), which means "everything".
 */
export function serverWorkspace(): string {
  if (typeof window === 'undefined') return ''
  return (window as { __MD_RENDER_WORKSPACE__?: string }).__MD_RENDER_WORKSPACE__ ?? ''
}

/** Tauri shell. */
export function desktopBackend(): Backend {
  const asMeta = (documents: Array<{ id: number; label: string; path: string }>) =>
    documents.map((doc) => ({
      id: String(doc.id),
      label: doc.label,
      path: doc.path,
    }))

  const listDocuments = async (): Promise<DocumentMeta[]> =>
    asMeta(
      await invoke<Array<{ id: number; label: string; path: string }>>('list_documents'),
    )

  return {
    mode: 'desktop',
    writable: true,
    listDocuments,
    refreshDocuments: async () =>
      asMeta(
        await invoke<Array<{ id: number; label: string; path: string }>>(
          'refresh_documents',
        ),
      ),
    closeDocument: async (id) =>
      asMeta(
        await invoke<Array<{ id: number; label: string; path: string }>>(
          'remove_document',
          { id },
        ),
      ),
    readDocument: async (id) => {
      const documents = await listDocuments()
      const document = documents.find((doc) => doc.id === id)
      if (!document) throw new Error(`no document with id ${id}`)
      const content = await invoke<string>('read_file', { path: document.path })
      return { ...document, baseDir: dirname(document.path), content }
    },
    assetUrl: (path) => {
      try {
        return convertFileSrc(path)
      } catch {
        return path
      }
    },
    readFile: (path) => invoke<string>('read_file', { path }),
    writeFile: (path, content) => invoke<void>('write_file', { path, content }),
    exportMarkdown: (path, content) =>
      invoke<string>('export_markdown', { path, content }),
    getLaunchFile: () => invoke<string | null>('get_launch_file'),
    getViewState: async () => null,
    experiments: desktopExperiments(),
  }
}

/** The Tauri commands reject with the same `{error, message}` object the server sends. */
function desktopExperiments(): ExperimentsApi {
  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (!isTauri()) {
      throw new ExperimentsError(
        'unavailable',
        'Experiment data is not available here. Open this document with mdrender to see the plot.',
      )
    }
    try {
      return await invoke<T>(command, args)
    } catch (raw) {
      throw ExperimentsError.from(raw)
    }
  }
  return {
    listProjects: () => call<ProjectsResponse>('list_experiment_projects'),
    listRuns: (source, baseDir) =>
      call<RunsResponse>('list_experiment_runs', { source, baseDir: baseDir ?? null }),
    fetchSeries: (request) =>
      call<SeriesResponse>('fetch_experiment_series', {
        source: request.source,
        baseDir: request.baseDir ?? null,
        request: {
          runs: request.runs,
          keys: request.keys,
          max_points: request.maxPoints,
          keep_duplicate_steps: request.keepDuplicateSteps ?? false,
          if_version: request.ifVersion,
        },
      }),
  }
}

/** Query parameters naming a source. */
function sourceParams(source: DbSource, baseDir?: string | null): URLSearchParams {
  const params = new URLSearchParams()
  if (source.project !== undefined) params.set('project', source.project)
  if (source.db !== undefined) params.set('db', source.db)
  if (baseDir) params.set('base', baseDir)
  return params
}

/** The `/api/experiments` routes. Non-2xx answers carry a JSON error object. */
export function serverExperiments(base = ''): ExperimentsApi {
  const read = async <T>(response: Response): Promise<T> => {
    const text = await response.text()
    if (!response.ok) throw ExperimentsError.from(text, `request failed (${response.status})`)
    return JSON.parse(text) as T
  }
  const get = async <T>(path: string): Promise<T> => {
    let response: Response
    try {
      response = await fetch(`${base}${path}`)
    } catch (err) {
      throw new ExperimentsError('unavailable', `could not reach the server: ${String(err)}`)
    }
    return read<T>(response)
  }

  return {
    listProjects: () => get<ProjectsResponse>('/api/experiments/projects'),
    listRuns: (source, baseDir) =>
      get<RunsResponse>(`/api/experiments/runs?${sourceParams(source, baseDir)}`),
    fetchSeries: async (request) => {
      const params = sourceParams(request.source, request.baseDir)
      params.set('runs', request.runs.join(','))
      params.set('keys', request.keys.join(','))
      if (request.maxPoints !== undefined) params.set('max_points', String(request.maxPoints))
      if (request.keepDuplicateSteps) params.set('keep_duplicate_steps', 'true')
      if (request.ifVersion) params.set('if_version', request.ifVersion)
      const query = params.toString()
      const hasComma = [...request.runs, ...request.keys].some((name) => name.includes(','))
      if (!hasComma && query.length < 6000) {
        return get<SeriesResponse>(`/api/experiments/series?${query}`)
      }
      // Names with commas, or a long list: the JSON form.
      let response: Response
      try {
        response = await fetch(`${base}/api/experiments/series`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: request.source,
            base: request.baseDir ?? null,
            runs: request.runs,
            keys: request.keys,
            max_points: request.maxPoints,
            keep_duplicate_steps: request.keepDuplicateSteps ?? false,
            if_version: request.ifVersion,
          }),
        })
      } catch (err) {
        throw new ExperimentsError('unavailable', `could not reach the server: ${String(err)}`)
      }
      return read<SeriesResponse>(response)
    },
  }
}

/**
 * Browser talking to the headless server. Read-only by design.
 *
 * `base` is empty in the browser, where same-origin relative URLs are right.
 * Tests pass an absolute origin so they can drive a real server process.
 */
export function serverBackend(base = ''): Backend {
  const fetchDocuments = async (refresh: boolean): Promise<DocumentMeta[]> => {
    const params = new URLSearchParams()
    if (refresh) params.set('refresh', 'true')
    const workspace = serverWorkspace()
    if (workspace) params.set('ws', workspace)
    const query = params.toString()
    const response = await fetch(`${base}/api/files${query ? `?${query}` : ''}`)
    if (!response.ok) throw new Error(`could not list documents (${response.status})`)
    const documents = (await response.json()) as Array<{
      id: number
      label: string
      path: string
    }>
    return documents.map((doc) => ({
      id: String(doc.id),
      label: doc.label,
      path: doc.path,
    }))
  }

  return {
    mode: 'server',
    // Full parity with the desktop app: editing, saving and exporting all work.
    // Writes are limited to the documents the server was told to open and carry
    // the injected token.
    writable: true,
    listDocuments: () => fetchDocuments(false),
    refreshDocuments: () => fetchDocuments(true),
    closeDocument: async (id) => {
      const workspace = serverWorkspace()
      const ws = workspace ? `&ws=${encodeURIComponent(workspace)}` : ''
      const response = await fetch(`${base}/api/file?id=${encodeURIComponent(id)}${ws}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${serverToken()}` },
      })
      if (!response.ok) throw new Error(`could not close document (${response.status})`)
      const documents = (await response.json()) as Array<{
        id: number
        label: string
        path: string
      }>
      return documents.map((doc) => ({
        id: String(doc.id),
        label: doc.label,
        path: doc.path,
      }))
    },
    readDocument: async (id) => {
      const response = await fetch(`${base}/api/file?id=${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error(`could not read document (${response.status})`)
      const body = (await response.json()) as {
        id: number
        label: string
        path: string
        base_dir: string
        content: string
      }
      return {
        id: String(body.id),
        label: body.label,
        path: body.path,
        baseDir: body.base_dir,
        content: body.content,
      }
    },
    assetUrl: (path) => `${base}/api/asset?path=${encodeURIComponent(path)}`,
    readFile: async (path) => {
      const response = await fetch(`${base}/api/read?path=${encodeURIComponent(path)}`)
      if (!response.ok) throw new Error(`could not read file (${response.status})`)
      const body = (await response.json()) as { content: string }
      return body.content
    },
    writeFile: async (path, content) => {
      const response = await fetch(`${base}/api/file`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverToken()}`,
        },
        body: JSON.stringify({ path, content }),
      })
      if (!response.ok) throw new Error(`could not save (${response.status})`)
    },
    exportMarkdown: async (path, content) => {
      const response = await fetch(`${base}/api/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverToken()}`,
        },
        body: JSON.stringify({ path, content }),
      })
      if (!response.ok) throw new Error(`could not export (${response.status})`)
      const body = (await response.json()) as { path: string }
      return body.path
    },
    getLaunchFile: async () => null,
    getViewState: async () => {
      const workspace = serverWorkspace()
      if (!workspace) return null
      const response = await fetch(`${base}/api/view?ws=${encodeURIComponent(workspace)}`)
      if (!response.ok) return null
      const body = (await response.json()) as {
        doc: number | null
        theme: string | null
        seq: number
      }
      return {
        doc: body.doc === null ? null : String(body.doc),
        theme: body.theme,
        seq: body.seq,
      }
    },
    experiments: serverExperiments(base),
  }
}

/**
 * Is this page being served by `md-render --port`? The server injects a marker
 * into the `index.html` it serves, so this is known synchronously on first
 * render — no probe, and no flash of the wrong content. Anywhere else (the
 * desktop shell, `npm run dev`, tests) there is no marker and the app keeps its
 * existing desktop behaviour.
 */
export function isServerMode(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as { __MD_RENDER_SERVER__?: boolean }).__MD_RENDER_SERVER__ === true
  )
}

/** The backend implied by the current environment. */
export function detectBackend(): Backend {
  return isServerMode() ? serverBackend() : desktopBackend()
}
