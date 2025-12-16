import { useState, useCallback, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { useTheme } from './hooks/useTheme'
import { sampleMarkdown } from './lib/sampleMarkdown'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'

const MIN_PANE_WIDTH = 280
const DEFAULT_SPLIT = 0.45

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [content, setContent] = useState(sampleMarkdown)
  const [fileLoaded, setFileLoaded] = useState(false)

  // Load file helper
  const loadFile = useCallback(async (filePath: string) => {
    try {
      const text = await invoke<string>('read_file', { path: filePath })
      setContent(text)
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
      setFileLoaded(true)
    }

    initializeFile()
  }, [loadFile])

  // Listen for file open events (from macOS Finder double-click)
  useEffect(() => {
    let unlistenOpenFile: (() => void) | undefined
    let unlistenDeepLink: (() => void) | undefined

    const setupListeners = async () => {
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
  const [splitPosition, setSplitPosition] = useState(DEFAULT_SPLIT)
  const [isDragging, setIsDragging] = useState(false)
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const toggleEditor = useCallback(() => {
    setIsEditorCollapsed(prev => !prev)
  }, [])

  // Persist content to localStorage
  useEffect(() => {
    localStorage.setItem('md-render-content', content)
  }, [content])

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
      <div className="floating-controls">
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
          className="floating-btn"
          onClick={toggleTheme}
          whileTap={{ scale: 0.95 }}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          {theme === 'light' ? <SunIcon /> : <MoonIcon />}
        </motion.button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 flex overflow-hidden"
      >
        {/* Editor Pane */}
        <motion.div
          className="h-full overflow-hidden"
          initial={false}
          animate={{
            width: isEditorCollapsed ? 0 : `${splitPosition * 100}%`,
            opacity: isEditorCollapsed ? 0 : 1
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
            opacity: isEditorCollapsed ? 0 : 1
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        />

        {/* Preview Pane */}
        <motion.div
          className="h-full overflow-hidden"
          initial={false}
          animate={{
            width: isEditorCollapsed ? '100%' : `${(1 - splitPosition) * 100}%`
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        >
          <Preview content={content} />
        </motion.div>
      </div>
    </div>
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

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

