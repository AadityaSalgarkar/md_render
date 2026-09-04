/**
 * MCP server for md-render's `--port` web mode, spoken over stdio.
 *
 * Everything a reader can do by hand in the browser — open and close
 * directories and tabs, read and save documents, comment, export — plus
 * starting and stopping servers and steering an open page, as tools.
 * Nothing here writes to stdout except the protocol itself.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerServerTools } from './tools/servers.ts'
import { registerTabTools } from './tools/tabs.ts'
import { registerWorkspaceTools } from './tools/workspaces.ts'

declare const __MD_RENDER_VERSION__: string | undefined

const version = typeof __MD_RENDER_VERSION__ === 'string' ? __MD_RENDER_VERSION__ : '0.0.0-dev'

const server = new McpServer({ name: 'mdrender', version })
registerServerTools(server)
registerWorkspaceTools(server)
registerTabTools(server)

const transport = new StdioServerTransport()
await server.connect(transport)
