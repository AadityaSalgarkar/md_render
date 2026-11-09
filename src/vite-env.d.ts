/// <reference types="vite/client" />

/** Globals `md-render --port` injects into the index.html it serves. */
interface Window {
  __MD_RENDER_SERVER__?: boolean
  __MD_RENDER_TOKEN__?: string
  __MD_RENDER_WORKSPACE__?: string
}

declare module '*.css' {
  const content: string
  export default content
}
