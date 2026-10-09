/**
 * The `/api/experiments` routes of `md-render --port`, as an ExperimentsApi.
 * No Tauri imports, so the MCP server can use it too.
 */

import {
  ExperimentsError,
  type DbSource,
  type ExperimentsApi,
  type ProjectsResponse,
  type RunsResponse,
  type SeriesResponse,
} from './types'

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
