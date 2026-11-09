/**
 * What a backend call rejected with, read once into a typed value. Tauri
 * rejects with the serialized error body as a string; the HTTP server answers
 * with the same JSON as text; anything else is an Error or an unknown value.
 */
export interface Rejection<Code extends string> {
  code: Code
  message: string
  log: string[]
  path?: string
}

export function readRejection<Code extends string>(
  raw: unknown,
  codes: readonly Code[],
  fallback: { code: Code; message: string },
): Rejection<Code> {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { code: fallback.code, message: raw || fallback.message, log: [] }
    }
  }
  if (value instanceof Error) return { code: fallback.code, message: value.message, log: [] }
  if (typeof value !== 'object' || value === null) return { code: fallback.code, message: fallback.message, log: [] }

  const body: { error?: unknown; message?: unknown; log?: unknown; path?: unknown } = value
  if (typeof body.message !== 'string') return { code: fallback.code, message: fallback.message, log: [] }
  const code = codes.find((c) => c === body.error) ?? fallback.code
  const log = Array.isArray(body.log) ? body.log.filter((line): line is string => typeof line === 'string') : []
  const rejection: Rejection<Code> = { code, message: body.message, log }
  if (typeof body.path === 'string') rejection.path = body.path
  return rejection
}

/** The message of anything thrown: an Error's own, or the value as text. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
