import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { themes } from '../../../src/lib/themes.ts'
import { docUrl, workspaceUrl } from '../client.ts'
import { resolveServer } from '../servers.ts'
import { portSchema } from './servers.ts'
import { MdRenderClient, ToolError } from '../client.ts'
import { registerTool, resolveTab, resolveWorkspace } from './shared.ts'

const builtinList = themes.map((theme) => `${theme.id} (${theme.name}, ${theme.mode})`).join('; ')
const INSTALL_NOTE =
  'More themes (latex, claude, sonnet, warm-paper, midnight-ink, paradigm, ...) are packages the user installs with `mdrender --install-theme NAME`; `mdrender --list-themes` shows them all.'

/** The built-in themes plus those of every installed package. */
async function availableThemes(client: MdRenderClient) {
  const installed = (await client.listThemes()).flatMap((pkg) =>
    pkg.themes
      .filter((t) => typeof t.id === 'string')
      .map((t) => ({ id: t.id as string, name: t.name ?? t.id, mode: t.mode, package: pkg.package })),
  )
  return [...themes.map((t) => ({ id: t.id, name: t.name, mode: t.mode, package: 'built-in' })), ...installed]
}

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
    `Switch the typographic theme on every browser page showing a workspace. Built in: ${builtinList}; installed packages add more (list_themes). ${APPLY_NOTE}`,
    {
      theme: z.string().min(1).describe('Theme id, from list_themes'),
      workspace: z
        .string()
        .min(1)
        .optional()
        .describe('Workspace name; omit when the server has only one'),
      port: portSchema,
    },
    async ({ theme, workspace, port }) => {
      const live = await resolveServer(port)
      const available = await availableThemes(live.client)
      if (!available.some((t) => t.id === theme)) {
        throw new ToolError(
          `no theme ${JSON.stringify(theme)} on this server; available: ${available.map((t) => t.id).join(', ')}. ${INSTALL_NOTE}`,
        )
      }
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

  registerTool(
    server,
    'list_themes',
    `The themes set_theme accepts on a server: the built-in Claudette pair and the themes of every installed package. ${INSTALL_NOTE}`,
    { port: portSchema },
    async ({ port }) => {
      const live = await resolveServer(port)
      return { themes: await availableThemes(live.client), note: INSTALL_NOTE }
    },
  )
}
