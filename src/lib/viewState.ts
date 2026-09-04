import type { DocumentMeta, ViewState } from './backend'

/** Which command a page should act on, if any. */
export interface ViewCommand {
  seq: number
  doc?: string
  theme?: string
}

const key = (workspace: string) => `md-render-view-seq:${workspace}`

/**
 * The last sequence this browser tab applied. Kept in sessionStorage so a
 * reload of the same tab does not jump back to a command already acted on,
 * while a freshly opened tab still applies the latest one once.
 */
export function readAppliedSeq(workspace: string): number {
  if (typeof window === 'undefined' || !workspace) return 0
  try {
    const stored = window.sessionStorage.getItem(key(workspace))
    const parsed = stored === null ? 0 : Number(stored)
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export function writeAppliedSeq(workspace: string, seq: number): void {
  if (typeof window === 'undefined' || !workspace) return
  try {
    window.sessionStorage.setItem(key(workspace), String(seq))
  } catch {
    // Storage unavailable: the command still applies, it may just replay
    // after a reload.
  }
}

/**
 * The command in `view` that has not been applied yet, or `null`. A tab that
 * is no longer open is dropped from the command but its sequence is still
 * consumed, so a stale focus does not keep retrying.
 */
export function pendingViewCommand(
  view: ViewState | null,
  lastApplied: number,
  documents: DocumentMeta[],
): ViewCommand | null {
  if (!view || view.seq <= lastApplied) return null

  const command: ViewCommand = { seq: view.seq }
  if (view.doc !== null && documents.some((doc) => doc.id === view.doc)) {
    command.doc = view.doc
  }
  if (view.theme) command.theme = view.theme
  return command
}
