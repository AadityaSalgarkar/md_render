import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { ThemePicker } from './components/ThemePicker'
import { CommentPane } from './components/CommentPane'
import { TabBar } from './components/Header'
import { useTheme } from './hooks/useTheme'
import { sampleMarkdown } from './lib/sampleMarkdown'
import { dirname } from './lib/resolveImageSrc'
import {
  insertCommentForSelection,
  parseChatThreads,
  stripCommentThreads,
} from './lib/comments'
import { detectBackend, type Backend, type DocumentMeta } from './lib/backend'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { getCurrentWindow } from '@tauri-apps/api/window'

const MIN_PANE_WIDTH = 280
const DEFAULT_SPLIT = 0.45
const FILE_SYNC_INTERVAL_MS = 30_000
/** How often server mode re-checks the tab list, so tabs added by a second
 *  `md-render --port` invocation show up without a reload. */
const DOCUMENT_POLL_INTERVAL_MS = 3_000

function readStoredToc(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem('md-render-toc') !== 'false'
}

export default function App() {
  const { themeId, setTheme, themes } = useTheme()
  // Desktop unless the server injected its marker into the page.
  const [backend] = useState<Backend>(() => detectBackend())
  const [documents, setDocuments] = useState<DocumentMeta[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [documentsChecked, setDocumentsChecked] = useState(false)
  const [content, setContent] = useState(sampleMarkdown)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [baseDir, setBaseDir] = useState<string | null>(null)
  const [fileLoaded, setFileLoaded] = useState(false)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [saveState, setSaveState] = useState<string | null>(null)
  const [exportState, setExportState] = useState<string | null>(null)
  const contentRef = useRef(content)
  const filePathRef = useRef<string | null>(null)
  const activeDocIdRef = useRef<string | null>(null)
  const fileSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const hasUnsavedChangesRef = useRef(false)
  const closeAfterSaveRef = useRef(false)

  // Held in a ref so the callbacks below keep a stable identity when the
  // backend is swapped after the server probe resolves.
  const backendRef = useRef(backend)
  useEffect(() => {
    backendRef.current = backend
  }, [backend])

  const updateContent = useCallback((nextContent: string) => {
    contentRef.current = nextContent
    setContent(nextContent)
  }, [])

  // Load file helper
  const loadFile = useCallback(async (filePath: string) => {
    try {
      const text = await backendRef.current.readFile(filePath)
      updateContent(text)
      filePathRef.current = filePath
      hasUnsavedChangesRef.current = false
      setFilePath(filePath)
      setBaseDir(dirname(filePath))
      setFileLoaded(true)
    } catch (err) {
      console.error('Failed to load file:', err)
    }
  }, [updateContent])

  /** Load one of the open documents (a tab) into the preview. */
  const loadDocument = useCallback(async (id: string) => {
    try {
      const document = await backendRef.current.readDocument(id)
      updateContent(document.content)
      filePathRef.current = document.path
      hasUnsavedChangesRef.current = false
      activeDocIdRef.current = document.id
      setFilePath(document.path)
      setBaseDir(document.baseDir)
      setActiveDocId(document.id)
      setFileLoaded(true)

      // Reflect the tab in the URL so reloads and browser tabs are stable.
      const url = new URL(window.location.href)
      url.searchParams.set('doc', document.id)
      window.history.replaceState(null, '', url.toString())
    } catch (err) {
      console.error('Failed to load document:', err)
    }
  }, [updateContent])

  // Both modes build their tabs from the same document list. Server mode keeps
  // polling so documents handed to the running server by a later
  // `md-render --port` invocation appear on their own; the desktop list is
  // fixed at launch, so one pass is enough.
  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const found = await backend.listDocuments()
        if (cancelled) return
        setDocuments(found)
        if (found.length > 0) setDocumentsChecked(true)

        const current = activeDocIdRef.current
        if (!current || !found.some((doc) => doc.id === current)) {
          const requested = new URLSearchParams(window.location.search).get('doc')
          const initial = found.find((doc) => doc.id === requested) ?? found[0]
          if (initial) await loadDocument(initial.id)
        }
      } catch {
        // No document list available (plain browser, or the desktop command is
        // missing): the startup path below falls back to the local draft.
      } finally {
        if (!cancelled) setDocumentsChecked(true)
      }
    }

    void refresh()
    if (backend.mode !== 'server') return () => {
      cancelled = true
    }

    const interval = window.setInterval(() => void refresh(), DOCUMENT_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [backend, loadDocument])

  // Load file on startup and persist content to localStorage
  useEffect(() => {
    // Wait for the document list; when there is one it supplies the content.
    if (!documentsChecked) return
    if (documents.length > 0) return

    const initializeFile = async () => {
      // Check for launch file from Tauri
      try {
        const launchFile = await backendRef.current.getLaunchFile()
        if (launchFile) {
          loadFile(launchFile)
          return
        }
      } catch {
        // Not in Tauri
      }

      // Check for query parameter
      const params = new URLSearchParams(window.location.search)
      const queryFile = params.get('file')
      if (queryFile) {
        loadFile(queryFile)
        return
      }

      // Load from localStorage if no file was launched
      const stored = localStorage.getItem('md-render-content')
      if (stored !== null) {
        updateContent(stored)
      }
      filePathRef.current = null
      hasUnsavedChangesRef.current = false
      setFilePath(null)
      setFileLoaded(true)
    }

    initializeFile()
  }, [documents, documentsChecked, loadFile, updateContent])

  /**
   * A file handed to the running app — a Finder double-click or a deep link.
   * It joins the tab strip instead of replacing whatever is open.
   */
  const openExternalFile = useCallback(async (filePath: string) => {
    try {
      const found = await invoke<Array<{ id: number; label: string; path: string }>>(
        'add_document',
        { path: filePath },
      )
      const meta = found.map((doc) => ({
        id: String(doc.id),
        label: doc.label,
        path: doc.path,
      }))
      setDocuments(meta)
      setDocumentsChecked(true)

      const opened = meta.find((doc) => doc.path === filePath)
      if (opened) {
        await loadDocument(opened.id)
        return
      }
    } catch {
      // Older shell without the command, or not in Tauri at all.
    }
    await loadFile(filePath)
  }, [loadDocument, loadFile])

  // Listen for file open events (from macOS Finder double-click)
  useEffect(() => {
    let unlistenOpenFile: (() => void) | undefined
    let unlistenDeepLink: (() => void) | undefined

    const setupListeners = async () => {
      try {
        // Listen for custom open-file event from Rust backend
        unlistenOpenFile = await listen<string>('open-file', (event) => {
          void openExternalFile(event.payload)
        })

        // Listen for deep-link events (macOS file associations)
        unlistenDeepLink = await onOpenUrl((urls) => {
          for (const url of urls) {
            if (url.startsWith('file://')) {
              const filePath = decodeURIComponent(url.replace('file://', ''))
              void openExternalFile(filePath)
              break
            }
          }
        })
      } catch {
        // Tauri APIs are unavailable outside the desktop shell (web mode).
      }
    }

    setupListeners()

    return () => {
      unlistenOpenFile?.()
      unlistenDeepLink?.()
    }
  }, [openExternalFile])

  // Persist content to localStorage when changed (but not on first load). The
  // browser and the desktop webview have separate storage, so this does not
  // cross over between the two.
  useEffect(() => {
    if (fileLoaded) {
      localStorage.setItem('md-render-content', content)
    }
  }, [content, fileLoaded])

  const renderedContent = useMemo(() => stripCommentThreads(content), [content])
  const commentThreads = useMemo(() => parseChatThreads(content), [content])

  const [splitPosition, setSplitPosition] = useState(DEFAULT_SPLIT)
  const [isDragging, setIsDragging] = useState(false)
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(true)
  const [isTocOpen, setIsTocOpen] = useState(readStoredToc)
  const containerRef = useRef<HTMLDivElement>(null)

  const toggleEditor = useCallback(() => {
    setIsEditorCollapsed((prev) => !prev)
  }, [])

  const toggleToc = useCallback(() => {
    setIsTocOpen((prev) => {
      const next = !prev
      localStorage.setItem('md-render-toc', String(next))
      return next
    })
  }, [])

  /** Rescan for documents added since launch and show them as tabs. */
  const handleRefreshDocuments = useCallback(async () => {
    try {
      const found = await backendRef.current.refreshDocuments()
      setDocuments(found)
      setDocumentsChecked(true)
      if (!activeDocIdRef.current && found.length > 0) {
        await loadDocument(found[0].id)
      }
    } catch (err) {
      console.error('Failed to refresh documents:', err)
    }
  }, [loadDocument])

  const handleTextSelection = useCallback((text: string) => {
    setSelectedText(text)
    setCommentsOpen(true)
    setSaveState(null)
  }, [])

  const writeOpenFile = useCallback((path: string, nextContent: string) => {
    const save = fileSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await backendRef.current.writeFile(path, nextContent)
        if (filePathRef.current === path && contentRef.current === nextContent) {
          hasUnsavedChangesRef.current = false
        }
      })
    fileSaveQueueRef.current = save
    return save
  }, [])

  const handleEditorChange = useCallback((nextContent: string) => {
    updateContent(nextContent)
    if (filePathRef.current) {
      hasUnsavedChangesRef.current = true
      setSaveState('Unsaved changes.')
    }
  }, [updateContent])

  const syncOpenFile = useCallback(async (status: 'manual' | 'periodic' | 'close') => {
    const path = filePathRef.current
    if (!path) {
      if (status === 'manual') {
        const stored = localStorage.getItem('md-render-content')
        if (stored !== null) updateContent(stored)
        setSaveState('Refreshed from local draft.')
      }
      return
    }

    if (hasUnsavedChangesRef.current) {
      try {
        await writeOpenFile(path, contentRef.current)
        if (!hasUnsavedChangesRef.current && status !== 'close') {
          setSaveState('Autosaved to markdown file.')
        }
      } catch (err) {
        if (status !== 'close') {
          setSaveState('Could not write to the markdown file.')
        }
        throw err
      }
      return
    }

    try {
      const text = await backendRef.current.readFile(path)
      if (text !== contentRef.current) {
        updateContent(text)
        setSaveState('Refreshed from markdown file.')
      } else if (status === 'manual') {
        setSaveState('Refreshed from markdown file.')
      }
      setBaseDir(dirname(path))
    } catch (err) {
      if (status !== 'close') {
        setSaveState('Could not refresh the markdown file.')
      }
      throw err
    }
  }, [updateContent, writeOpenFile])

  const saveContentToFile = useCallback(async (nextContent: string) => {
    updateContent(nextContent)
    if (filePath) {
      hasUnsavedChangesRef.current = true
      await writeOpenFile(filePath, nextContent)
    }
  }, [filePath, updateContent, writeOpenFile])

  const handleSaveComment = useCallback(async (comment: string) => {
    if (!selectedText) return
    const result = insertCommentForSelection(content, selectedText, comment)
    if (!result.inserted) return

    try {
      await saveContentToFile(result.content)
      setSelectedText(null)
      setSaveState(filePath ? 'Saved to markdown file.' : 'Saved to local draft.')
    } catch (err) {
      setSaveState('Could not write to the markdown file.')
      console.error('Failed to save comment:', err)
    }
  }, [content, filePath, saveContentToFile, selectedText])

  const handleRefreshComments = useCallback(async () => {
    try {
      await syncOpenFile('manual')
    } catch (err) {
      console.error('Failed to refresh comments:', err)
    }
  }, [syncOpenFile])

  const handleSaveNow = useCallback(async () => {
    const path = filePathRef.current
    if (!path) {
      localStorage.setItem('md-render-content', contentRef.current)
      setSaveState('Saved local draft.')
      return
    }

    try {
      hasUnsavedChangesRef.current = true
      await writeOpenFile(path, contentRef.current)
      setSaveState('Saved to markdown file.')
    } catch (err) {
      setSaveState('Could not write to the markdown file.')
      console.error('Failed to save file:', err)
    }
  }, [writeOpenFile])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void syncOpenFile('periodic').catch((err) => {
        console.error('Failed to sync markdown file:', err)
      })
    }, FILE_SYNC_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [syncOpenFile])

  useEffect(() => {
    let unlisten: (() => void) | undefined

    const setupCloseGuard = async () => {
      try {
        const appWindow = getCurrentWindow()
        unlisten = await appWindow.onCloseRequested(async (event) => {
          if (closeAfterSaveRef.current) return
          event.preventDefault()

          try {
            await syncOpenFile('close')
            await fileSaveQueueRef.current
          } catch (err) {
            console.error('Failed to finish autosave before closing:', err)
          } finally {
            closeAfterSaveRef.current = true
            await appWindow.close()
          }
        })
      } catch {
        // Tauri window APIs are unavailable outside the desktop shell (web mode).
      }
    }

    setupCloseGuard()

    return () => {
      unlisten?.()
    }
  }, [syncOpenFile])

  const handleExportCleanMarkdown = useCallback(async () => {
    const cleanContent = stripCommentThreads(content)
    if (!filePath) {
      downloadMarkdown(cleanContent, 'md-render-export.md')
      setExportState('Downloaded clean markdown.')
      return
    }

    try {
      const outputPath = await backendRef.current.exportMarkdown(filePath, cleanContent)
      setExportState(`Exported ${basename(outputPath)}`)
    } catch (err) {
      setExportState('Could not export clean markdown.')
      console.error('Failed to export markdown:', err)
    }
  }, [content, filePath])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return

    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const containerWidth = rect.width

    // Calculate position as percentage
    let newPosition = x / containerWidth

    // Clamp to minimum pane widths
    const minPercent = MIN_PANE_WIDTH / containerWidth
    newPosition = Math.max(minPercent, Math.min(1 - minPercent, newPosition))

    setSplitPosition(newPosition)
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Add/remove global mouse listeners for drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const readOnly = !backend.writable

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <TabBar documents={documents} activeId={activeDocId} onSelect={loadDocument} />
      <div className="flex-1 flex overflow-hidden relative">
      {/* Floating Controls */}
      <div className={`floating-controls ${commentsOpen ? 'comments-open' : ''}`}>
        <motion.button
          className={`floating-btn ${isTocOpen ? 'is-on' : ''}`}
          onClick={toggleToc}
          whileTap={{ scale: 0.95 }}
          aria-pressed={isTocOpen}
          aria-label={isTocOpen ? 'Hide document index' : 'Show document index'}
          title="Index"
        >
          <IndexIcon />
        </motion.button>

        {!readOnly && (
          <motion.button
            className="floating-btn"
            onClick={toggleEditor}
            whileTap={{ scale: 0.95 }}
            aria-label={isEditorCollapsed ? 'Show editor' : 'Hide editor'}
            title={isEditorCollapsed ? 'Edit' : 'Read'}
          >
            {isEditorCollapsed ? <EditIcon /> : <EyeIcon />}
          </motion.button>
        )}

        {!readOnly && (
          <motion.button
            className="floating-btn"
            onClick={handleSaveNow}
            whileTap={{ scale: 0.95 }}
            aria-label="Save markdown"
            title="Save"
          >
            <SaveIcon />
          </motion.button>
        )}

        <motion.button
          className="floating-btn"
          onClick={handleRefreshDocuments}
          whileTap={{ scale: 0.95 }}
          aria-label="Refresh documents"
          title="Refresh documents"
        >
          <RefreshIcon />
        </motion.button>

        <motion.button
          className={`floating-btn ${commentsOpen ? 'is-on' : ''}`}
          onClick={() => setCommentsOpen((prev) => !prev)}
          whileTap={{ scale: 0.95 }}
          aria-pressed={commentsOpen}
          aria-label={commentsOpen ? 'Hide comments' : 'Show comments'}
          title="Comments"
        >
          <CommentIcon />
        </motion.button>

        <ThemePicker themes={themes} activeId={themeId} onSelect={setTheme} />
      </div>

      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {/* Editor Pane */}
        <motion.div
          className="h-full overflow-hidden"
          initial={false}
          animate={{
            width: isEditorCollapsed ? 0 : `${splitPosition * 100}%`,
            opacity: isEditorCollapsed ? 0 : 1,
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        >
          <Editor value={content} onChange={handleEditorChange} />
        </motion.div>

        {/* Divider */}
        <motion.div
          className={`divider ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          initial={false}
          animate={{
            width: isEditorCollapsed ? 0 : 6,
            opacity: isEditorCollapsed ? 0 : 1,
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        />

        {/* Preview Pane */}
        <motion.div
          className="h-full overflow-hidden"
          initial={false}
          animate={{
            width: isEditorCollapsed ? '100%' : `${(1 - splitPosition) * 100}%`,
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        >
          <Preview
            content={renderedContent}
            tocOpen={isTocOpen}
            baseDir={baseDir}
            assetUrl={backend.assetUrl}
            onTextSelection={handleTextSelection}
          />
        </motion.div>
        <CommentPane
          open={commentsOpen}
          selectedText={selectedText}
          threads={commentThreads}
          saveState={saveState}
          exportState={exportState}
          onSave={handleSaveComment}
          onRefresh={handleRefreshComments}
          onExport={handleExportCleanMarkdown}
          onClose={() => setCommentsOpen(false)}
          readOnly={readOnly}
        />
      </div>
      </div>
    </div>
  )
}

function IndexIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="13" y2="13" />
    </svg>
  )
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
