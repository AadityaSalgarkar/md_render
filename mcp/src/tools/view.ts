import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { themes } from '../../../src/lib/themes.ts'
import { docUrl, workspaceUrl } from '../client.ts'
import { resolveServer } from '../servers.ts'
import { portSchema } from './servers.ts'
import { registerTool, resolveTab, resolveWorkspace } from './shared.ts'

const themeIds = themes.map((theme) => theme.id) as [string, ...string[]]
const themeList = themes.map((theme) => `${theme.id} (${theme.name}, ${theme.mode})`).join('; ')

const APPLY_NOTE = 'Every open page of the workspace applies this on its next poll, within about 3 seconds.'

export function registerViewTools(server: McpServer): void {
  registerTool(
    server,
    'focus_tab',
    `Bring a tab to the front in every browser page showing its workspace, re-reading it from disk (this is how to show a fresh write immediately; note it discards unsaved edits the reader had in that tab). Also returns the URL that opens the tab directly. ${APPLY_NOTE}`,
    {
      id: z.number().int().optional().describe('Tab id from list_tabs'),
      path: z.string().min(1).optional().describe('Path of the open file, instead of id'),
      workspace: z.string().min(1).optional().describe('Workspace name, to disambiguate'),
      port: portSchema,
    },
    async ({ id, path, workspace, port }) => {
      const live = await resolveServer(port)
      const tab = await resolveTab(live.client, { id, path, workspace })
      const view = await live.client.setView(tab.workspace, { doc: tab.id })
      return {
        workspace: tab.workspace,
        doc: tab.id,
        label: tab.label,
        seq: view.seq,
        url: docUrl(live.port, tab.workspace, tab.id),
        note: APPLY_NOTE,
      }
    },
  )

  registerTool(
    server,
    'set_theme',
    `Switch the typographic theme on every browser page showing a workspace. Themes: ${themeList}. ${APPLY_NOTE}`,
    {
      theme: z.enum(themeIds).describe('Theme id'),
      workspace: z
        .string()
        .min(1)
        .optional()
        .describe('Workspace name; omit when the server has only one'),
      port: portSchema,
    },
    async ({ theme, workspace, port }) => {
      const live = await resolveServer(port)
      const name = await resolveWorkspace(live.client, workspace)
      const view = await live.client.setView(name, { theme })
      return {
        workspace: name,
        theme,
        seq: view.seq,
        url: workspaceUrl(live.port, name),
        note: APPLY_NOTE,
      }
    },
  )
}
