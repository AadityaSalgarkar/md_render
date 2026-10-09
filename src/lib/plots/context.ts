import { createContext } from 'react'
import type { ExperimentsApi } from './types'

/** What a plot needs from the document around it. */
export interface PlotEnvironment {
  experiments?: ExperimentsApi
  /** Directory of the open markdown file, for relative `db` paths. */
  baseDir?: string | null
  /** Identity of the open document, for remembering the chosen view. */
  documentKey?: string | null
}

export const PlotContext = createContext<PlotEnvironment>({})

/** How often `"refresh": "auto"` polls, and how recent a change keeps it polling. */
export const AUTO_REFRESH_MS = 15_000
export const AUTO_REFRESH_WINDOW_MS = 10 * 60_000
