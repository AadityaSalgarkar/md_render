import { convertFileSrc } from '@tauri-apps/api/core'

/** Schemes that already point at something the webview can load directly. */
const PASSTHROUGH = /^(https?:|data:|blob:|asset:|tauri:)/i

/** POSIX dirname of a file path (`/a/b/c.md` -> `/a/b`). */
export function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  if (idx > 0) return filePath.slice(0, idx)
  return idx === 0 ? '/' : ''
}

/** Collapse `.` / `..` segments in a POSIX path. */
function normalizePosix(path: string): string {
  const isAbsolute = path.startsWith('/')
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute) out.push('..')
    } else {
      out.push(part)
    }
  }
  return (isAbsolute ? '/' : '') + out.join('/')
}

/**
 * Resolve a markdown image path to an absolute POSIX path. `file://` URLs are
 * unwrapped, relative paths are joined onto `baseDir`, absolute paths pass
 * through. Relative paths with no `baseDir` are returned unchanged.
 */
export function resolvePath(baseDir: string | null | undefined, src: string): string {
  let path = src
  if (path.startsWith('file://')) {
    path = decodeURIComponent(path.slice('file://'.length))
  }
  if (!path.startsWith('/')) {
    if (!baseDir) return path
    path = `${baseDir.replace(/\/+$/, '')}/${path}`
  }
  return normalizePosix(path)
}

/**
 * Turn a markdown image `src` into something the webview can render. Remote,
 * `data:` and `blob:` URLs are returned unchanged; local files are resolved
 * against `baseDir` and handed to Tauri's asset protocol. Outside Tauri (web
 * mode, tests) it degrades to the resolved filesystem path.
 */
export function resolveImageSrc(
  src: string | undefined,
  baseDir: string | null | undefined,
): string {
  if (!src || PASSTHROUGH.test(src)) return src ?? ''
  const path = resolvePath(baseDir, src)
  if (!path.startsWith('/')) return src // unresolved relative path
  try {
    return convertFileSrc(path)
  } catch {
    return path
  }
}
