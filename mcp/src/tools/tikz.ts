import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { baseUrl } from '../client.ts'
import { resolveServer } from '../servers.ts'
import { portSchema } from './servers.ts'
import { registerTool } from './shared.ts'

const HEADER_NOTE =
  'Header lines are TeX comments: "%! packages: pgfplots, tikz-cd", "%! libraries: arrows.meta, positioning", "%! preamble: ...", "%! caption: the lesson of the figure". The body is one or more tikzpicture (or tikzcd) environments, or a whole \\documentclass ... \\end{document}.'

export function registerTikzTools(server: McpServer): void {
  registerTool(
    server,
    'render_tikz',
    `Compile a TikZ block the way the reader will, to check it before writing it into a document as a \`\`\`tikz fence. Returns the SVG size and its URL, or the TeX error lines. Compiled diagrams are cached, so the reader sees them at once. The first compile on a machine downloads TeX files and can take minutes. ${HEADER_NOTE}`,
    {
      source: z.string().min(1).describe('The block: optional %! header lines, then TikZ'),
      port: portSchema,
    },
    async ({ source, port }) => {
      const live = await resolveServer(port)
      const rendered = await live.client.tikz(source)
      return {
        compiled: true,
        cached: rendered.cached,
        svg_bytes: rendered.svg.length,
        url: `${baseUrl(live.port)}/api/tikz/${rendered.key}.svg`,
      }
    },
  )
}
