import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { ToolError, isRemote } from '../client.ts'
import { resolveServer } from '../servers.ts'
import { portSchema } from './servers.ts'
import { describeTab, registerTool, resolveTab, resolveWorkspace } from './shared.ts'

const workspaceSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Workspace name; omit when the server has only one')

export function registerTabTools(server: McpServer): void {
  registerTool(
    server,
    'list_tabs',
    'List open tabs with their ids, labels, paths, workspace and the URL that opens each one. Omit workspace to see every workspace at once.',
    { workspace: workspaceSchema, port: portSchema },
    async ({ workspace, port }) => {
      const live = await resolveServer(port)
      if (workspace) await resolveWorkspace(live.client, workspace)
      const tabs = (await live.client.files(workspace)).map((doc) => describeTab(live.port, doc))
      return { port: live.port, tabs }
    },
  )

  registerTool(
    server,
    'open_tab',
    'Open a markdown file, or a URL (https://…, GitHub file pages included; downloaded under /tmp/md-render/remote), as a tab. With a workspace (or when a served workspace contains the file; the most specific one wins) it joins that workspace under a label relative to it, so a closed nested file comes back where it was. Otherwise the file joins the workspace of its own directory, creating one if needed. A file already open is reported, not duplicated.',
    {
      path: z.string().min(1).describe('Markdown file, absolute or relative to the MCP process'),
      workspace: workspaceSchema,
      port: portSchema,
    },
    async ({ path: raw, workspace, port }) => {
      const live = await resolveServer(port)

      if (isRemote(raw)) {
        // The server downloads it under /tmp/md-render/remote and puts it in
        // the workspace standing for its origin (one per GitHub repository).
        if (workspace) await resolveWorkspace(live.client, workspace)
        const result = await live.client.addDocuments([raw], workspace)
        const tab = result.documents[0]
        if (!tab) throw new ToolError(`the server accepted ${raw} but does not list it as a tab`)
        const { added, ...entry } = tab
        return {
          ...describeTab(live.port, entry),
          alreadyOpen: !added,
          placement: added ? 'downloaded' : 'downloaded earlier; still the same tab',
          source: raw,
        }
      }

      const file = path.resolve(raw)
      if (!existsSync(file)) throw new ToolError(`cannot read '${file}'`)
      const canonical = realpathSync(file)

      let target = workspace
      let placement: string
      if (target) {
        await resolveWorkspace(live.client, target)
        placement = `named workspace '${target}'`
      } else {
        // Workspaces can nest (a project and its docs/ both served); the
        // most specific one containing the file is the one meant.
        const containing = (await live.client.workspaces())
          .filter((ws) => canonical === ws.dir || canonical.startsWith(ws.dir + path.sep))
          .sort((a, b) => b.dir.length - a.dir.length)
        if (containing.length > 0) {
          target = containing[0].name
          placement = `the most specific workspace containing it, '${target}'`
        } else {
          placement = "the workspace of the file's own directory (created if needed)"
        }
      }

      const result = await live.client.addDocuments([file], target)
      const tab = result.documents.find((doc) => doc.path === canonical) ?? result.documents[0]
      if (!tab) {
        throw new ToolError(`the server accepted ${file} but does not list it as a tab`)
      }
      const { added, ...entry } = tab
      return {
        ...describeTab(live.port, entry),
        alreadyOpen: !added,
        placement,
      }
    },
  )

  registerTool(
    server,
    'close_tab',
    'Close a tab by id or path. The file stays on disk and stays closed across refreshes until it is opened again with open_tab.',
    {
      id: z.number().int().optional().describe('Tab id from list_tabs'),
      path: z.string().min(1).optional().describe('Path of the open file, instead of id'),
      workspace: workspaceSchema,
      port: portSchema,
    },
    async ({ id, path: file, workspace, port }) => {
      const live = await resolveServer(port)
      const tab = await resolveTab(live.client, { id, path: file, workspace })
      const remaining = await live.client.closeDocument(tab.id, tab.workspace)
      return {
        closed: { id: tab.id, label: tab.label, path: tab.path, workspace: tab.workspace },
        remaining: remaining.map((doc) => describeTab(live.port, doc)),
      }
    },
  )

  registerTool(
    server,
    'refresh',
    'Rescan the directories a workspace was opened from and add tabs for markdown files created since. Closed tabs stay closed. Omit workspace to refresh all of them.',
    { workspace: workspaceSchema, port: portSchema },
    async ({ workspace, port }) => {
      const live = await resolveServer(port)
      if (workspace) await resolveWorkspace(live.client, workspace)
      const tabs = (await live.client.files(workspace, true)).map((doc) => describeTab(live.port, doc))
      return { port: live.port, tabs }
    },
  )
}
