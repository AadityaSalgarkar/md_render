import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { listServers, startServer, stopServer } from '../servers.ts'
import { registerTool } from './shared.ts'

export const portSchema = z
  .number()
  .int()
  .min(1)
  .max(65535)
  .optional()
  .describe(
    'Port of the md-render server to talk to. Omit when exactly one server is running; list_servers shows them.',
  )

export function registerServerTools(server: McpServer): void {
  registerTool(
    server,
    'list_servers',
    'List every md-render server this user has started: port, pid, whether it answers, its URL and its workspaces. Stale records left by killed servers are cleaned up and reported once. Call this first when unsure which port to use.',
    {},
    async () => ({ servers: await listServers() }),
  )

  registerTool(
    server,
    'start_server',
    'Serve markdown files, directories or URLs in the browser: starts `md-render --port` detached and returns the workspace URLs to give the human. Each directory (or a file\'s parent) becomes a workspace at http://127.0.0.1:PORT/<dirname>/. Without a port the first usable one from 9999 is taken; if an md-render server already holds that port the paths are added to it instead (attached: true). Binds 127.0.0.1 unless host is given; only pass a host when the human asked to expose the server.',
    {
      paths: z
        .array(z.string().min(1))
        .min(1)
        .describe('Markdown files, directories and/or URLs (https://…, GitHub file pages included) to serve; local paths absolute or relative to the MCP process'),
      port: portSchema,
      host: z.string().optional().describe('Address to bind; default 127.0.0.1'),
    },
    async ({ paths, port, host }) => startServer({ paths, port, host }),
  )

  registerTool(
    server,
    'stop_server',
    'Stop the md-render server on a port. Asks it to shut down cleanly (in-flight saves finish, its state record is removed) and falls back to SIGTERM if it does not stop within five seconds.',
    { port: z.number().int().min(1).max(65535).describe('Port of the server to stop') },
    async ({ port }) => stopServer(port),
  )
}
