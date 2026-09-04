import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { ZodRawShapeCompat, ShapeOutput } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { MdRenderClient, ToolError, docUrl, type DocumentEntry } from '../client.ts'

/** A tab as tools report it: the tab list entry plus where to see it. */
export interface Tab extends DocumentEntry {
  url: string
}

export function describeTab(port: number, doc: DocumentEntry): Tab {
  return { ...doc, url: docUrl(port, doc.workspace, doc.id) }
}

/**
 * Register a tool whose handler returns plain data. The data goes back as
 * pretty JSON text; a ToolError (or anything thrown) becomes an error result
 * with the message, which is what the agent needs to decide its next step.
 */
export function registerTool<Shape extends ZodRawShapeCompat>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (args: ShapeOutput<Shape>) => Promise<unknown>,
): void {
  const callback = async (args: ShapeOutput<Shape>): Promise<CallToolResult> => {
    try {
      const result = await handler(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
  // The SDK resolves the callback's argument type through a conditional on
  // the concrete shape, which a generic cannot satisfy; the shape is what
  // makes `args` correct at every call site.
  server.registerTool(
    name,
    { description, inputSchema },
    callback as unknown as ToolCallback<Shape>,
  )
}

/** The workspace a tool means: the one named, or the only one there is. */
export async function resolveWorkspace(client: MdRenderClient, name?: string): Promise<string> {
  const workspaces = await client.workspaces()
  if (name) {
    if (!workspaces.some((ws) => ws.name === name)) {
      throw new ToolError(
        `no workspace named '${name}' on port ${client.port}; open one of: ${workspaces.map((ws) => ws.name).join(', ') || '(none; call open_directory)'}`,
      )
    }
    return name
  }
  if (workspaces.length === 1) return workspaces[0].name
  if (workspaces.length === 0) {
    throw new ToolError(`port ${client.port} serves no workspace; call open_directory or start_server`)
  }
  throw new ToolError(
    `port ${client.port} serves several workspaces (${workspaces.map((ws) => ws.name).join(', ')}); pass workspace`,
  )
}

function samePath(a: string, b: string): boolean {
  const canon = (p: string) => {
    try {
      return realpathSync(p)
    } catch {
      return path.resolve(p)
    }
  }
  return canon(a) === canon(b)
}

/** The tab a tool means, by id or by path, optionally within one workspace. */
export async function resolveTab(
  client: MdRenderClient,
  target: { id?: number; path?: string; workspace?: string },
): Promise<DocumentEntry> {
  if (target.id === undefined && !target.path) {
    throw new ToolError('give either id or path')
  }
  const tabs = await client.files(target.workspace)

  if (target.id !== undefined) {
    const tab = tabs.find((doc) => doc.id === target.id)
    if (!tab) {
      throw new ToolError(
        `no open tab with id ${target.id}${target.workspace ? ` in workspace '${target.workspace}'` : ''}; call list_tabs`,
      )
    }
    return tab
  }

  const wanted = target.path!
  const matches = tabs.filter((doc) => samePath(doc.path, wanted))
  if (matches.length === 0) {
    throw new ToolError(`${wanted} is not an open tab; call open_tab first`)
  }
  if (matches.length > 1) {
    throw new ToolError(
      `${wanted} is open in several workspaces (${matches.map((doc) => doc.workspace).join(', ')}); pass workspace`,
    )
  }
  return matches[0]
}
