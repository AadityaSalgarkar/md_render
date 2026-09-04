import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { ToolError, workspaceUrl } from '../client.ts'
import { resolveServer, summariseWorkspaces } from '../servers.ts'
import { portSchema } from './servers.ts'
import { describeTab, registerTool, resolveWorkspace } from './shared.ts'

export function registerWorkspaceTools(server: McpServer): void {
  registerTool(
    server,
    'list_workspaces',
    'List the workspaces a server hosts: name, directory, tab count and the URL a human opens for each.',
    { port: portSchema },
    async ({ port }) => {
      const live = await resolveServer(port)
      return {
        port: live.port,
        workspaces: summariseWorkspaces(live.port, await live.client.workspaces()),
      }
    },
  )

  registerTool(
    server,
    'open_directory',
    'Open a directory as a workspace on a running server: every markdown file beneath it becomes a tab at http://127.0.0.1:PORT/<dirname>/. A directory that is already served just reports its workspace. Open browsers pick the change up within a few seconds.',
    {
      path: z.string().min(1).describe('Directory to serve, absolute or relative to the MCP process'),
      port: portSchema,
    },
    async ({ path: raw, port }) => {
      const dir = path.resolve(raw)
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        throw new ToolError(`${dir} is not a directory; use open_tab for a single file`)
      }
      const live = await resolveServer(port)
      const result = await live.client.addDocuments([dir])
      const canonical = realpathSync(dir)
      const workspace = (await live.client.workspaces()).find((ws) => ws.dir === canonical)
      if (!workspace) {
        throw new ToolError(`the server accepted ${dir} but reports no workspace for it`)
      }
      const tabs = (await live.client.files(workspace.name)).map((doc) => describeTab(live.port, doc))
      return {
        workspace: workspace.name,
        dir: workspace.dir,
        url: workspaceUrl(live.port, workspace.name),
        added: result.added,
        tabs,
      }
    },
  )

  registerTool(
    server,
    'close_workspace',
    'Close a workspace: its tabs and its URL go away and its name is free again. Files on disk are untouched.',
    {
      workspace: z.string().min(1).describe('Workspace name, as list_workspaces reports it'),
      port: portSchema,
    },
    async ({ workspace, port }) => {
      const live = await resolveServer(port)
      const name = await resolveWorkspace(live.client, workspace)
      const remaining = await live.client.closeWorkspace(name)
      return {
        closed: name,
        remaining: summariseWorkspaces(live.port, remaining),
      }
    },
  )
}
