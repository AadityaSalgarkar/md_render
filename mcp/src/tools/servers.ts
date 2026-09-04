import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listServers } from '../servers.ts'
import { registerTool } from './shared.ts'

export function registerServerTools(server: McpServer): void {
  registerTool(
    server,
    'list_servers',
    'List every md-render server this user has started: port, pid, whether it answers, its URL and its workspaces. Stale records left by killed servers are cleaned up and reported once. Call this first when unsure which port to use.',
    {},
    async () => ({ servers: await listServers() }),
  )
}
