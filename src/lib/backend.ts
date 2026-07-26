import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { dirname } from './resolveImageSrc'

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
  readDocument(id: string): Promise<DocumentBody>
  /** Turn an absolute image path into something the page can load. */
  assetUrl(path: string): string
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  exportMarkdown(path: string, content: string): Promise<string>
  getLaunchFile(): Promise<string | null>
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Token the server injected into the page; required for anything that writes. */
function serverToken(): string {
  if (typeof window === 'undefined') return ''
  return (window as { __MD_RENDER_TOKEN__?: string }).__MD_RENDER_TOKEN__ ?? ''
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
    const response = await fetch(`${base}/api/files${refresh ? '?refresh=true' : ''}`)
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
