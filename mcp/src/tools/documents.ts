import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import path from 'node:path'
import { z } from 'zod'
import { insertCommentForSelection, stripCommentThreads } from '../../../src/lib/comments.ts'
import { ToolError } from '../client.ts'
import { resolveServer } from '../servers.ts'
import { portSchema } from './servers.ts'
import { describeTab, registerTool, resolveTab } from './shared.ts'

const workspaceSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Workspace name, to disambiguate a file open in several')

const SYNC_NOTE =
  'An open browser re-reads the file within 30 seconds unless it holds unsaved edits, in which case its edits win; call focus_tab to make it reload now.'

export function registerDocumentTools(server: McpServer): void {
  registerTool(
    server,
    'read_document',
    'Read an open tab by id or path: its content as on disk, with review comments still inline as <chat><comment>…</comment></chat> blocks.',
    {
      id: z.number().int().optional().describe('Tab id from list_tabs'),
      path: z.string().min(1).optional().describe('Path of the open file, instead of id'),
      workspace: workspaceSchema,
      port: portSchema,
    },
    async ({ id, path: file, workspace, port }) => {
      const live = await resolveServer(port)
      const tab = await resolveTab(live.client, { id, path: file, workspace })
      const body = await live.client.file(tab.id)
      return { ...describeTab(live.port, tab), content: body.content }
    },
  )

  registerTool(
    server,
    'write_document',
    `Replace the content of an open tab on disk. Only files that are open as tabs can be written; open_tab first otherwise. ${SYNC_NOTE}`,
    {
      path: z.string().min(1).describe('Path of the open file'),
      content: z.string().describe('The whole new file content'),
      workspace: workspaceSchema,
      port: portSchema,
    },
    async ({ path: file, content, workspace, port }) => {
      const live = await resolveServer(port)
      const tab = await resolveTab(live.client, { path: file, workspace })
      await live.client.write(tab.path, content)
      return { ...describeTab(live.port, tab), written: true, note: SYNC_NOTE }
    },
  )

  registerTool(
    server,
    'add_comment',
    `Attach a review comment to a passage of an open tab, the way a reader does by highlighting text: a <chat><comment>…</comment></chat> block is inserted right after the first occurrence of the passage and the file is saved. If the passage is not found verbatim the comment is appended at the end with a "Comment target" note (anchored: false). ${SYNC_NOTE}`,
    {
      path: z.string().min(1).describe('Path of the open file'),
      passage: z.string().min(1).describe('Text in the document the comment is about, quoted exactly'),
      comment: z.string().min(1).describe('The comment'),
      workspace: workspaceSchema,
      port: portSchema,
    },
    async ({ path: file, passage, comment, workspace, port }) => {
      const live = await resolveServer(port)
      const tab = await resolveTab(live.client, { path: file, workspace })
      const current = await live.client.read(tab.path)
      const result = insertCommentForSelection(current, passage, comment)
      if (!result.inserted) throw new ToolError('passage and comment must both be non-empty')
      await live.client.write(tab.path, result.content)
      // A passage that was not found gets a "Comment target" note instead of
      // an anchor; one more of those than before means this comment did.
      const notes = (text: string) => text.split('> Comment target:').length
      const anchored = notes(result.content) === notes(current)
      return { ...describeTab(live.port, tab), anchored, note: SYNC_NOTE }
    },
  )

  registerTool(
    server,
    'export_clean',
    'Write a copy of an open tab with every review comment block stripped, as NAME.clean.EXT beside it (what the "Export clean" button does). Returns the output path.',
    {
      path: z.string().min(1).describe('Path of the open file'),
      workspace: workspaceSchema,
      port: portSchema,
    },
    async ({ path: file, workspace, port }) => {
      const live = await resolveServer(port)
      const tab = await resolveTab(live.client, { path: file, workspace })
      const current = await live.client.read(tab.path)
      const outputPath = await live.client.export(tab.path, stripCommentThreads(current) + '\n')
      return {
        source: tab.path,
        outputPath,
        outputLabel: path.basename(outputPath),
        note: 'The clean copy is not opened as a tab; open_tab it if the human should see it.',
      }
    },
  )
}
