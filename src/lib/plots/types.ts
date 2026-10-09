/**
 * Wire types for experiment data, matching `src-tauri/src/experiments.rs`.
 * Shared by the reader (backend.ts, ExperimentPlot) and the MCP server.
 */

/** Where a plot's data lives: a trackio project, or a database path. */
export interface DbSource {
  project?: string
  db?: string
}

export interface ProjectInfo {
  name: string
  path: string
  bytes: number
  modified_ms: number
  wal: boolean
}

export interface ProjectsResponse {
  dir: string
  projects: ProjectInfo[]
}

export interface KeyInfo {
  key: string
  /** Rows holding a scalar for this key. */
  count: number
}

/** A flattened config value: dot path to scalar. */
export type ConfigValue = string | number | boolean | null

export interface RunInfo {
  name: string
  ids: string[]
  ambiguous: boolean
  created_at: string | null
  first_step: number
  last_step: number
  rows: number
  first_ms: number | null
  last_ms: number | null
  keys: KeyInfo[]
  config: Record<string, ConfigValue>
}

export interface RunsResponse {
  db: string
  version: string
  schema: number
  immutable: boolean
  modified_ms: number
  runs: RunInfo[]
}

export interface Summary {
  first: number
  last: number
  min: number
  max: number
  mean: number
  argmin_step: number
  argmax_step: number
}

/** step, value, wall-clock ms (null when the timestamp did not parse). */
export type Point = [number, number, number | null]

export interface Series {
  run: string
  key: string
  n: number
  n_nonfinite: number
  downsampled: boolean
  summary: Summary | null
  points: Point[]
}

export interface SeriesData {
  db: string
  version: string
  schema: number
  immutable: boolean
  modified_ms: number
  series: Series[]
  missing: Array<{ run: string; key: string }>
}

export interface SeriesUnchanged {
  unchanged: true
  version: string
  modified_ms: number
}

export type SeriesResponse = SeriesData | SeriesUnchanged

export interface SeriesRequest {
  source: DbSource
  /** Directory of the markdown file, to resolve a relative `db`. */
  baseDir?: string | null
  runs: string[]
  keys: string[]
  /** Points per series after downsampling; 0 for summaries only. */
  maxPoints?: number
  keepDuplicateSteps?: boolean
  ifVersion?: string
}

export function isUnchanged(response: SeriesResponse): response is SeriesUnchanged {
  return 'unchanged' in response && response.unchanged === true
}

/** Error codes the backend answers with. */
export type ExperimentsErrorCode =
  | 'bad_request'
  | 'forbidden'
  | 'not_found'
  | 'bad_schema'
  | 'locked'
  | 'io'
  | 'unavailable'

export class ExperimentsError extends Error {
  code: ExperimentsErrorCode
  path?: string

  constructor(code: ExperimentsErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'ExperimentsError'
    this.code = code
    this.path = path
  }

  /** Build from whatever the backend rejected with: the JSON error object or text. */
  static from(raw: unknown, fallback = 'could not read experiment data'): ExperimentsError {
    if (raw instanceof ExperimentsError) return raw
    let value = raw
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw)
      } catch {
        return new ExperimentsError('io', raw || fallback)
      }
    }
    if (value && typeof value === 'object' && 'error' in value && 'message' in value) {
      const body = value as { error: ExperimentsErrorCode; message: string; path?: string }
      return new ExperimentsError(body.error, body.message, body.path)
    }
    if (value instanceof Error) return new ExperimentsError('io', value.message)
    return new ExperimentsError('io', fallback)
  }
}

export interface ExperimentsApi {
  listProjects(): Promise<ProjectsResponse>
  listRuns(source: DbSource, baseDir?: string | null): Promise<RunsResponse>
  fetchSeries(request: SeriesRequest): Promise<SeriesResponse>
}
