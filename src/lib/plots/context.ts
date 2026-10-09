import { createContext } from 'react'
import type { ExperimentsApi } from './types'
import type { TikzApi } from '../tikz'

/** What plots and TikZ diagrams need from the document around them. */
export interface PlotEnvironment {
  experiments?: ExperimentsApi
  /** Compiles TikZ blocks; absent where nothing can compile. */
  tikz?: TikzApi
  /** Directory of the open markdown file, for relative `db` paths. */
  baseDir?: string | null
  /** Identity of the open document, for remembering the chosen view. */
  documentKey?: string | null
}

export const PlotContext = createContext<PlotEnvironment>({})

/** How often `"refresh": "auto"` polls, and how recent a change keeps it polling. */
export const AUTO_REFRESH_MS = 15_000
export const AUTO_REFRESH_WINDOW_MS = 10 * 60_000
