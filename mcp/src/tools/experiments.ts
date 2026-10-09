import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { serverExperiments } from '../../../src/lib/plots/http.ts'
import { parsePlotBlock } from '../../../src/lib/plots/schema.ts'
import { configCandidates, deriveViews, keysOf } from '../../../src/lib/plots/views.ts'
import {
  ExperimentsError,
  isUnchanged,
  type DbSource,
  type RunInfo,
} from '../../../src/lib/plots/types.ts'
import { ToolError, baseUrl } from '../client.ts'
import { resolveServer } from '../servers.ts'
import { portSchema } from './servers.ts'
import { registerTool } from './shared.ts'

/** Most points per series an agent can ask for; more would flood its context. */
export const MAX_AGENT_POINTS = 2000

const sourceShape = {
  project: z.string().min(1).optional().describe('trackio project name (a database in the trackio directory)'),
  db: z
    .string()
    .min(1)
    .optional()
    .describe('Path to a trackio .db file instead of a project; relative paths resolve against `base`'),
  base: z
    .string()
    .optional()
    .describe('Directory of the markdown report, so a relative `db` resolves the way the block will'),
  port: portSchema,
}

function sourceOf(args: { project?: string; db?: string }): DbSource {
  if ((args.project === undefined) === (args.db === undefined)) {
    throw new ToolError('give exactly one of `project` or `db`')
  }
  return args.project !== undefined ? { project: args.project } : { db: args.db }
}

async function api(port?: number) {
  const live = await resolveServer(port)
  return serverExperiments(baseUrl(live.port))
}

function toolError(err: unknown): never {
  if (err instanceof ExperimentsError) throw new ToolError(`${err.code}: ${err.message}`)
  throw err
}

/** Names closest to a missing one: shared prefix or substring, best first. */
export function nearest(name: string, candidates: string[], limit = 5): string[] {
  const lower = name.toLowerCase()
  const score = (candidate: string) => {
    const c = candidate.toLowerCase()
    if (c.includes(lower) || lower.includes(c)) return 1000 - Math.abs(c.length - lower.length)
    let prefix = 0
    while (prefix < c.length && prefix < lower.length && c[prefix] === lower[prefix]) prefix += 1
    const tail = lower.split(/[/_.-]/).pop() ?? ''
    return prefix * 10 + (tail && c.includes(tail) ? 50 : 0)
  }
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

const BLOCK_NOTE =
  'Reference the database in a <plot> block as "source": {"project": NAME}, or {"db": PATH} relative to the markdown file. In server mode a db outside the trackio directory must sit inside a served folder.'

export function registerExperimentTools(server: McpServer): void {
  registerTool(
    server,
    'list_projects',
    'List trackio experiment databases (one per project) in the trackio directory, newest first, so a report can plot them with <plot> blocks. Call list_runs next.',
    { port: portSchema },
    async ({ port }) => {
      const experiments = await api(port)
      const projects = await experiments.listProjects().catch(toolError)
      return { ...projects, note: BLOCK_NOTE }
    },
  )

  registerTool(
    server,
    'list_runs',
    'List the runs of a trackio database: step range, row count, scalar metric keys and the config keys that split the runs into groups. Also returns suggested_views, the dropdown a <plot> block over these runs will offer, so a report can name views that exist. Use before writing a <plot> block.',
    {
      ...sourceShape,
      metrics: z.string().optional().describe('Regex to keep only some metric keys in the listing'),
      full_config: z
        .boolean()
        .optional()
        .describe('Include every flattened config value, not only the keys that group runs (can be large)'),
    },
    async ({ project, db, base, port, metrics, full_config }) => {
      const source = sourceOf({ project, db })
      const experiments = await api(port)
      const response = await experiments.listRuns(source, base).catch(toolError)
      let keep: RegExp | null = null
      if (metrics) {
        try {
          keep = new RegExp(metrics)
        } catch (err) {
          throw new ToolError(`metrics: ${(err as Error).message}`)
        }
      }
      const grouping = configCandidates(response.runs)
      const runs = response.runs.map((run: RunInfo) => ({
        name: run.name,
        steps: [run.first_step, run.last_step],
        rows: run.rows,
        ambiguous: run.ambiguous || undefined,
        keys: run.keys.map((k) => k.key).filter((k) => !keep || keep.test(k)),
        config: full_config
          ? run.config
          : Object.fromEntries(grouping.filter((k) => k in run.config).map((k) => [k, run.config[k]])),
      }))
      const parsed = parsePlotBlock(JSON.stringify({ plot_type: 'line', source, metrics: metrics ?? '.*' }))
      const suggested = parsed.ok
        ? deriveViews(parsed.spec, response.runs).map((view) => ({
            name: view.name,
            metrics: view.metrics,
            group_by: view.group_by,
          }))
        : []
      return {
        db: response.db,
        schema: response.schema,
        snapshot: response.immutable || undefined,
        keys: keysOf(response.runs).filter((k) => !keep || keep.test(k)),
        grouping_config_keys: grouping,
        runs,
        suggested_views: suggested,
        note: BLOCK_NOTE,
      }
    },
  )

  registerTool(
    server,
    'read_metrics',
    `Read metric values from a trackio database to quote in a report: for each run and key, a summary (first, last, min, max, mean and the steps of the extremes). Set max_points to also get downsampled [step, value, time_ms] points (at most ${MAX_AGENT_POINTS}). A run or key that does not exist is reported with the nearest names.`,
    {
      ...sourceShape,
      runs: z.array(z.string().min(1)).min(1).describe('Run names, from list_runs'),
      keys: z.array(z.string().min(1)).min(1).describe('Metric keys, from list_runs'),
      max_points: z
        .number()
        .int()
        .min(0)
        .max(MAX_AGENT_POINTS)
        .optional()
        .describe('Points per series to include; 0 (the default) returns summaries only'),
    },
    async ({ project, db, base, port, runs, keys, max_points }) => {
      const source = sourceOf({ project, db })
      const experiments = await api(port)
      const response = await experiments
        .fetchSeries({ source, baseDir: base, runs, keys, maxPoints: max_points ?? 0 })
        .catch(toolError)
      if (isUnchanged(response)) throw new ToolError('unexpected unchanged answer')

      let missing: Array<{ run: string; key: string; nearest_runs?: string[]; nearest_keys?: string[] }> = []
      if (response.missing.length > 0) {
        const listing = await experiments.listRuns(source, base).catch(toolError)
        const runNames = listing.runs.map((r) => r.name)
        const allKeys = keysOf(listing.runs)
        missing = response.missing.map(({ run, key }) => {
          const known = listing.runs.find((r) => r.name === run)
          return {
            run,
            key,
            nearest_runs: known ? undefined : nearest(run, runNames),
            nearest_keys: known && !known.keys.some((k) => k.key === key) ? nearest(key, known.keys.map((k) => k.key)) : known ? undefined : nearest(key, allKeys),
          }
        })
      }
      return {
        db: response.db,
        series: response.series.map((s) => ({
          run: s.run,
          key: s.key,
          n: s.n,
          non_finite: s.n_nonfinite || undefined,
          summary: s.summary,
          points: max_points ? s.points : undefined,
          downsampled: max_points ? s.downsampled : undefined,
        })),
        missing: missing.length ? missing : undefined,
      }
    },
  )
}
