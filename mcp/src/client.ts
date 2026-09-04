/**
 * Typed HTTP client for one running `md-render --port` server. Every
 * non-2xx answer becomes a ToolError carrying the server's own message,
 * which is already phrased for a human or an agent.
 */

export class ToolError extends Error {}

export interface DocumentEntry {
  id: number
  label: string
  path: string
  workspace: string
}

export interface WorkspaceEntry {
  name: string
  dir: string
  documents: number
}

export interface ViewState {
  doc: number | null
  theme: string | null
  seq: number
}

export interface AddResult {
  added: string[]
  workspaces: string[]
  /** Every document the request named: just opened, or open already. */
  documents: Array<DocumentEntry & { added: boolean }>
}

export const HOST = '127.0.0.1'

/** A document on the internet rather than on disk; the server downloads it. */
export function isRemote(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://')
}

export function baseUrl(port: number): string {
  return `http://${HOST}:${port}`
}

export function workspaceUrl(port: number, workspace: string): string {
  return `${baseUrl(port)}/${workspace}/`
}

export function docUrl(port: number, workspace: string, id: number): string {
  return `${workspaceUrl(port, workspace)}?doc=${id}`
}

export class MdRenderClient {
  constructor(
    readonly port: number,
    private readonly token: string,
  ) {}

  private async request(
    method: string,
    path: string,
    options: { body?: unknown; auth?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {}
    if (options.auth) headers.Authorization = `Bearer ${this.token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await fetch(`${baseUrl(this.port)}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      throw new ToolError(
        `could not reach the md-render server on port ${this.port}: ${(err as Error).message}; call list_servers`,
      )
    }

    if (response.status === 401) {
      throw new ToolError(
        `the server on port ${this.port} rejected the token; it may have been started by another user`,
      )
    }
    if (!response.ok) {
      const text = (await response.text()).trim()
      throw new ToolError(`${method} ${path} failed (${response.status}): ${text}`)
    }
    return response
  }

  private async json<T>(method: string, path: string, options?: { body?: unknown; auth?: boolean }) {
    return (await (await this.request(method, path, options)).json()) as T
  }

  health() {
    return this.json<{ app: string; version: string }>('GET', '/api/health')
  }

  workspaces() {
    return this.json<WorkspaceEntry[]>('GET', '/api/workspaces')
  }

  files(workspace?: string, refresh = false) {
    const params = new URLSearchParams()
    if (workspace) params.set('ws', workspace)
    if (refresh) params.set('refresh', 'true')
    const query = params.toString()
    return this.json<DocumentEntry[]>('GET', `/api/files${query ? `?${query}` : ''}`)
  }

  file(id: number) {
    return this.json<DocumentEntry & { base_dir: string; content: string }>(
      'GET',
      `/api/file?id=${id}`,
    )
  }

  async read(path: string) {
    const body = await this.json<{ content: string }>(
      'GET',
      `/api/read?path=${encodeURIComponent(path)}`,
    )
    return body.content
  }

  async write(path: string, content: string) {
    await this.request('PUT', '/api/file', { body: { path, content }, auth: true })
  }

  async export(path: string, content: string) {
    const body = await this.json<{ path: string }>('POST', '/api/export', {
      body: { path, content },
      auth: true,
    })
    return body.path
  }

  addDocuments(paths: string[], workspace?: string) {
    const body: { paths: string[]; ws?: string } = { paths }
    if (workspace) body.ws = workspace
    return this.json<AddResult>('POST', '/api/documents', { body, auth: true })
  }

  closeDocument(id: number, workspace?: string) {
    const ws = workspace ? `&ws=${encodeURIComponent(workspace)}` : ''
    return this.json<DocumentEntry[]>('DELETE', `/api/file?id=${id}${ws}`, { auth: true })
  }

  closeWorkspace(name: string) {
    return this.json<WorkspaceEntry[]>(
      'DELETE',
      `/api/workspaces?name=${encodeURIComponent(name)}`,
      { auth: true },
    )
  }

  getView(workspace: string) {
    return this.json<ViewState>('GET', `/api/view?ws=${encodeURIComponent(workspace)}`)
  }

  setView(workspace: string, view: { doc?: number; theme?: string }) {
    return this.json<ViewState>('PUT', '/api/view', {
      body: { ws: workspace, ...view },
      auth: true,
    })
  }

  async shutdown() {
    await this.request('POST', '/api/shutdown', { auth: true })
  }
}
