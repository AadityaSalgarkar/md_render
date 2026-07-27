import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import { flushSync } from 'react-dom'
import { motion } from 'framer-motion'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import rehypeRaw from 'rehype-raw'
import rehypeSections from '../lib/rehypeSections'
import 'katex/dist/katex.min.css'
import type { Components } from 'react-markdown'
import { TableOfContents } from './TableOfContents'
import { ReadingProgress } from './ReadingProgress'
import { MermaidDiagram } from './MermaidDiagram'
import { Quiz, Enumerate, Option } from './Quiz'
import { resolveImageSrc } from '../lib/resolveImageSrc'
import { prepareQuizBlocks } from '../lib/quiz'
import type { Heading } from '../types'

interface PreviewProps {
  content: string
  tocOpen: boolean
  /** Directory of the open file — used to resolve relative image paths. */
  baseDir?: string | null
  /** Turns an absolute image path into a loadable URL; differs per backend. */
  assetUrl?: (path: string) => string
  onTextSelection?: (text: string) => void
  /** Identity of the open document; collapse state resets when it changes. */
  documentKey?: string | null
}

/** Collapse state shared with the heading and section renderers. */
interface CollapseState {
  collapsed: Set<string>
  toggle: (id: string) => void
}

const CollapseContext = createContext<CollapseState>({
  collapsed: new Set(),
  toggle: () => {},
})

/** Block script-bearing URLs; let everything else (file:, data:, …) through. */
function permissiveUrlTransform(url: string): string {
  return /^\s*(javascript|vbscript):/i.test(url) ? '' : url
}

/** Levels lifted into the index. */
const TOC_SELECTOR = 'h1[id], h2[id], h3[id]'

export function Preview({
  content,
  tocOpen,
  baseDir,
  assetUrl,
  onTextSelection,
  documentKey,
}: PreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // Collapsed section ids. Kept across content refreshes (autosave, the
  // 30-second sync) because the component stays mounted; reset when a
  // different document is opened.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const previousKeyRef = useRef(documentKey)
  useEffect(() => {
    if (previousKeyRef.current !== documentKey) {
      previousKeyRef.current = documentKey
      setCollapsed(new Set())
    }
  }, [documentKey])

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const collapseState = useMemo<CollapseState>(
    () => ({ collapsed, toggle: toggleSection }),
    [collapsed, toggleSection],
  )

  // Rewrite <quiz> tags to their parser-safe internal names before parsing.
  const preparedContent = useMemo(() => prepareQuizBlocks(content), [content])

  const components: Components = useMemo(() => ({
    pre: ({ children, ...props }) => <PreWithCopy {...props}>{children}</PreWithCopy>,
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    section: CollapsibleSection,
    // Decorative horizontal rule.
    hr: () => <div className="hr-ornament">◆  ◆  ◆</div>,
    // Resolve local/relative image paths against the open file's directory.
    img: ({ node, src, ...props }) => {
      void node
      return (
        <img
          src={resolveImageSrc(typeof src === 'string' ? src : '', baseDir, assetUrl)}
          {...props}
        />
      )
    },
    // Render task-list checkboxes as read-only.
    input: ({ type, checked, ...props }) => {
      if (type === 'checkbox') {
        return <input type="checkbox" checked={checked} readOnly {...props} />
      }
      return <input type={type} {...props} />
    },
    // Quiz blocks — authored as <quiz>/<enumerate>/<option>, rewritten to
    // these internal names by prepareQuizBlocks.
    ...({ 'md-quiz': Quiz, 'md-enumerate': Enumerate, 'md-option': Option } as Components),
  }), [assetUrl, baseDir])

  // Lift headings out of the rendered article so the index can mirror them.
  useEffect(() => {
    const article = articleRef.current
    if (!article) return
    const found: Heading[] = Array.from(
      article.querySelectorAll<HTMLElement>(TOC_SELECTOR),
    ).map((el) => ({
      id: el.id,
      text: (el.textContent ?? '').trim(),
      level: Number(el.tagName[1]),
    }))

    setHeadings((prev) => {
      const sig = (list: Heading[]) =>
        list.map((h) => `${h.level}:${h.id}:${h.text}`).join('|')
      return sig(prev) === sig(found) ? prev : found
    })
  }, [content])

  // Scroll-spy: highlight the index entry for the section in view.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || headings.length === 0) return
    setActiveId((prev) => (headings.some((h) => h.id === prev) ? prev : headings[0].id))

    if (typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        let next: string | null = null
        for (const h of headings) {
          if (visible.has(h.id)) next = h.id
        }
        if (next) setActiveId(next)
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )

    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [headings])

  const handleNavigate = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return

    // The target may sit inside collapsed sections; expand every collapsed
    // ancestor synchronously so the scroll lands on a visible element.
    const ancestors: string[] = []
    for (
      let parent = el.closest('section.md-section')?.parentElement ?? null;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.matches?.('section.md-section')) {
        const sectionId = parent.getAttribute('data-heading-id')
        if (sectionId) ancestors.push(sectionId)
      }
    }

    // Expand synchronously before scrolling — scrollIntoView on an element
    // inside a display:none body does nothing.
    flushSync(() => {
      setCollapsed((prev) => {
        const toExpand = ancestors.filter((sectionId) => prev.has(sectionId))
        if (toExpand.length === 0) return prev
        const next = new Set(prev)
        for (const sectionId of toExpand) next.delete(sectionId)
        return next
      })
    })
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveId(id)
  }, [])

  const handleSelection = useCallback(() => {
    if (!onTextSelection || !articleRef.current) return
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    if (!selection || !text || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    const selectedInsideArticle = articleRef.current.contains(
      container.nodeType === Node.ELEMENT_NODE
        ? container as Element
        : container.parentElement,
    )
    if (selectedInsideArticle) {
      onTextSelection(text)
    }
  }, [onTextSelection])

  return (
    <div className="reading-pane">
      <TableOfContents
        headings={headings}
        activeId={activeId}
        open={tocOpen}
        onNavigate={handleNavigate}
      />
      <div ref={scrollRef} className="preview-container">
        <ReadingProgress containerRef={scrollRef} resetKey={content} />
        <article
          ref={articleRef}
          className="markdown-body animate-fade-in"
          onMouseUp={handleSelection}
          onKeyUp={handleSelection}
        >
          <CollapseContext.Provider value={collapseState}>
            <Markdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeRaw, rehypeSlug, rehypeSections, rehypeHighlight, rehypeKatex]}
              components={components}
              urlTransform={permissiveUrlTransform}
            >
              {preparedContent}
            </Markdown>
          </CollapseContext.Provider>
        </article>
      </div>
    </div>
  )
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4'

type HeadingProps = React.ComponentPropsWithoutRef<HeadingTag> & {
  node?: unknown
  'data-collapsible'?: string
}

type SectionProps = React.ComponentPropsWithoutRef<'section'> & {
  node?: unknown
  'data-heading-id'?: string
}

/**
 * Section wrapper produced by rehypeSections. Applies the collapsed class so
 * CSS hides the body; the chevron lives on the heading inside.
 */
function CollapsibleSection({ children, node, className, ...props }: SectionProps) {
  void node
  const { collapsed } = useContext(CollapseContext)
  const id = props['data-heading-id']
  const isCollapsed = id ? collapsed.has(id) : false

  return (
    <section
      {...props}
      className={`${className ?? ''}${isCollapsed ? ' is-collapsed' : ''}`}
    >
      {children}
    </section>
  )
}

/**
 * Heading renderer: keeps rehype-slug's `id`, adds the hover anchor, and — for
 * section headings — the collapse chevron in the left gutter plus a `⋯` chip
 * while the section's body is hidden.
 */
function makeHeading(Tag: HeadingTag) {
  return function HeadingWithAnchor({ children, id, node, ...props }: HeadingProps) {
    void node // hast metadata from react-markdown — kept out of the DOM
    const { collapsed, toggle } = useContext(CollapseContext)
    const collapsible = props['data-collapsible'] === 'true' && Boolean(id)
    const isCollapsed = collapsible && id ? collapsed.has(id) : false

    return (
      <Tag id={id} {...props}>
        {collapsible && id && (
          <button
            type="button"
            className="section-toggle"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
            onClick={() => toggle(id)}
          >
            <motion.span
              className="section-chevron"
              initial={false}
              animate={{ rotate: isCollapsed ? -90 : 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <SectionChevronIcon />
            </motion.span>
          </button>
        )}
        {children}
        {isCollapsed && id && (
          <button
            type="button"
            className="section-ellipsis"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => toggle(id)}
          >
            ⋯
          </button>
        )}
        {id && (
          <a
            className="heading-anchor"
            href={`#${id}`}
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
      </Tag>
    )
  }
}

function SectionChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

interface PreWithCopyProps {
  children: React.ReactNode
  className?: string
}

function PreWithCopy({ children, className }: PreWithCopyProps) {
  const [copied, setCopied] = useState(false)
  const codeBlock = getCodeBlockChild(children)

  // Hooks must run unconditionally, so this sits before the Mermaid branch.
  const handleCopy = useCallback(async () => {
    const text = getTextContent(children)

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [children])

  if (codeBlock && isMermaidLanguage(codeBlock.props.className)) {
    return <MermaidDiagram chart={getTextContent(codeBlock.props.children).trim()} />
  }

  return (
    <div className="code-block-wrapper">
      <pre className={className}>{children}</pre>
      <button
        className={`copy-button ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        aria-label={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

interface CodeElementProps {
  children?: React.ReactNode
  className?: string
}

function getCodeBlockChild(children: React.ReactNode): React.ReactElement<CodeElementProps> | null {
  const [child] = Children.toArray(children)
  if (!isValidElement<CodeElementProps>(child)) return null
  return child.type === 'code' ? child : null
}

function isMermaidLanguage(className?: string): boolean {
  return (className ?? '')
    .toLowerCase()
    .split(/\s+/)
    .some((token) => (
      token === 'mermaid'
      || token === 'language-mermaid'
      || token === 'language-language-mermaid'
    ))
}

function getTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(getTextContent).join('')
  if (isValidElement<{ children?: React.ReactNode }>(node)) {
    return getTextContent(node.props.children)
  }
  return ''
}
