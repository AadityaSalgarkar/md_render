import { useState, useMemo, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import type { Heading } from '../types'

interface TableOfContentsProps {
  headings: Heading[]
  activeId: string | null
  open: boolean
  onNavigate: (id: string) => void
}

interface TocNode extends Heading {
  children: TocNode[]
}

const EXPANDED_WIDTH = 264

/** Nest the flat heading list into a tree and record each node's parent. */
function buildTree(headings: Heading[]): {
  roots: TocNode[]
  parentOf: Map<string, string>
} {
  const roots: TocNode[] = []
  const parentOf = new Map<string, string>()
  const stack: TocNode[] = []

  for (const heading of headings) {
    const node: TocNode = { ...heading, children: [] }
    while (stack.length && stack[stack.length - 1].level >= heading.level) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    if (parent) {
      parent.children.push(node)
      parentOf.set(node.id, parent.id)
    } else {
      roots.push(node)
    }
    stack.push(node)
  }
  return { roots, parentOf }
}

export function TableOfContents({
  headings,
  activeId,
  open,
  onNavigate,
}: TableOfContentsProps) {
  const { roots, parentOf } = useMemo(() => buildTree(headings), [headings])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // Keep the section containing the current reading position open.
  useEffect(() => {
    if (!activeId) return
    const ancestors: string[] = []
    let cursor = parentOf.get(activeId)
    while (cursor) {
      ancestors.push(cursor)
      cursor = parentOf.get(cursor)
    }
    setCollapsed((prev) => {
      if (!ancestors.some((id) => prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of ancestors) next.delete(id)
      return next
    })
  }, [activeId, parentOf])

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <motion.aside
      className="toc-sidebar"
      aria-label="Document index"
      initial={false}
      animate={{ width: open ? EXPANDED_WIDTH : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      <div className="toc-inner">
        <div className="toc-heading">
          <IndexIcon />
          <span>Index</span>
        </div>

        {headings.length === 0 ? (
          <p className="toc-empty">
            Add headings (<code># Title</code>) to grow an index.
          </p>
        ) : (
          <nav className="toc-nav">
            <TocList
              nodes={roots}
              depth={0}
              collapsed={collapsed}
              activeId={activeId}
              onToggle={toggle}
              onNavigate={onNavigate}
            />
          </nav>
        )}
      </div>
    </motion.aside>
  )
}

interface TocListProps {
  nodes: TocNode[]
  depth: number
  collapsed: Set<string>
  activeId: string | null
  onToggle: (id: string) => void
  onNavigate: (id: string) => void
}

function TocList({ nodes, depth, collapsed, activeId, onToggle, onNavigate }: TocListProps) {
  return (
    <ul className={depth === 0 ? 'toc-tree' : 'toc-subtree'}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isCollapsed = collapsed.has(node.id)
        const isActive = node.id === activeId
        return (
          <li key={node.id}>
            <div className="toc-row" style={{ paddingLeft: `${depth * 0.75}rem` }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="toc-toggle"
                  aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
                  aria-expanded={!isCollapsed}
                  onClick={() => onToggle(node.id)}
                >
                  <motion.span
                    className="toc-chevron"
                    initial={false}
                    animate={{ rotate: isCollapsed ? -90 : 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <ChevronIcon />
                  </motion.span>
                </button>
              ) : (
                <span className="toc-toggle-spacer" aria-hidden="true" />
              )}

              <button
                type="button"
                className={`toc-link toc-level-${node.level} ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onNavigate(node.id)}
              >
                <span className="toc-tick" aria-hidden="true" />
                <span className="toc-text">{node.text}</span>
              </button>
            </div>

            {hasChildren && !isCollapsed && (
              <TocList
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                activeId={activeId}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function IndexIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.5" y2="6" />
      <line x1="3" y1="12" x2="3.5" y2="12" />
      <line x1="3" y1="18" x2="3.5" y2="18" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
