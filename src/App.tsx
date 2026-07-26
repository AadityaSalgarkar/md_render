import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { ThemePicker } from './components/ThemePicker'
import { CommentPane } from './components/CommentPane'
import { useTheme } from './hooks/useTheme'
import { sampleMarkdown } from './lib/sampleMarkdown'
import { dirname } from './lib/resolveImageSrc'
import {
  insertCommentForSelection,
  parseChatThreads,
  stripCommentThreads,
} from './lib/comments'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'

const MIN_PANE_WIDTH = 280
const DEFAULT_SPLIT = 0.45

function readStoredToc(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem('md-render-toc') !== 'false'
}

export default function App() {
  const { themeId, setTheme, themes } = useTheme()
  const [content, setContent] = useState(sampleMarkdown)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [baseDir, setBaseDir] = useState<string | null>(null)
  const [fileLoaded, setFileLoaded] = useState(false)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [saveState, setSaveState] = useState<string | null>(null)
  const [exportState, setExportState] = useState<string | null>(null)

  // Load file helper
  const loadFile = useCallback(async (filePath: string) => {
    try {
      const text = await invoke<string>('read_file', { path: filePath })
      setContent(text)
      setFilePath(filePath)
      setBaseDir(dirname(filePath))
      setFileLoaded(true)
    } catch (err) {
      console.error('Failed to load file:', err)
    }
  }, [])

  // Load file on startup and persist content to localStorage
  useEffect(() => {
    const initializeFile = async () => {
      // Check for launch file from Tauri
      try {
        const launchFile = await invoke<string | null>('get_launch_file')
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
        setContent(stored)
      }
      setFilePath(null)
      setFileLoaded(true)
    }

    initializeFile()
  }, [loadFile])

  // Listen for file open events (from macOS Finder double-click)
  useEffect(() => {
    let unlistenOpenFile: (() => void) | undefined
    let unlistenDeepLink: (() => void) | undefined

    const setupListeners = async () => {
      try {
        // Listen for custom open-file event from Rust backend
        unlistenOpenFile = await listen<string>('open-file', (event) => {
          loadFile(event.payload)
        })

        // Listen for deep-link events (macOS file associations)
        unlistenDeepLink = await onOpenUrl((urls) => {
          for (const url of urls) {
            if (url.startsWith('file://')) {
              const filePath = decodeURIComponent(url.replace('file://', ''))
              loadFile(filePath)
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
  }, [loadFile])

  // Persist content to localStorage when changed (but not on first load)
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

  const handleTextSelection = useCallback((text: string) => {
    setSelectedText(text)
    setCommentsOpen(true)
    setSaveState(null)
  }, [])

  const saveContentToFile = useCallback(async (nextContent: string) => {
    if (filePath) {
      await invoke('write_file', { path: filePath, content: nextContent })
    }
    setContent(nextContent)
  }, [filePath])

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
    if (!filePath) {
      const stored = localStorage.getItem('md-render-content')
      if (stored !== null) setContent(stored)
      setSaveState('Refreshed from local draft.')
      return
    }

    try {
      const text = await invoke<string>('read_file', { path: filePath })
      setContent(text)
      setBaseDir(dirname(filePath))
      setSaveState('Refreshed from markdown file.')
    } catch (err) {
      setSaveState('Could not refresh the markdown file.')
      console.error('Failed to refresh comments:', err)
    }
  }, [filePath])

  const handleExportCleanMarkdown = useCallback(async () => {
    const cleanContent = stripCommentThreads(content)
    if (!filePath) {
      downloadMarkdown(cleanContent, 'md-render-export.md')
      setExportState('Downloaded clean markdown.')
      return
    }

    try {
      const outputPath = await invoke<string>('export_markdown', {
        path: filePath,
        content: cleanContent,
      })
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

  return (
    <div className="h-screen flex overflow-hidden relative">
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

        <motion.button
          className="floating-btn"
          onClick={toggleEditor}
          whileTap={{ scale: 0.95 }}
          aria-label={isEditorCollapsed ? 'Show editor' : 'Hide editor'}
          title={isEditorCollapsed ? 'Edit' : 'Read'}
        >
          {isEditorCollapsed ? <EditIcon /> : <EyeIcon />}
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
          <Editor value={content} onChange={setContent} />
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
        />
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
