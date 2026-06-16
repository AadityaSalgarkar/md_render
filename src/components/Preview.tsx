import {
  Children,
  isValidElement,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'
import type { Components } from 'react-markdown'
import { TableOfContents } from './TableOfContents'
import { ReadingProgress } from './ReadingProgress'
import { MermaidDiagram } from './MermaidDiagram'
import { resolveImageSrc } from '../lib/resolveImageSrc'
import type { Heading } from '../types'

interface PreviewProps {
  content: string
  tocOpen: boolean
  /** Directory of the open file — used to resolve relative image paths. */
  baseDir?: string | null
  onTextSelection?: (text: string) => void
}

/** Block script-bearing URLs; let everything else (file:, data:, …) through. */
function permissiveUrlTransform(url: string): string {
  return /^\s*(javascript|vbscript):/i.test(url) ? '' : url
}

/** Levels lifted into the index. */
const TOC_SELECTOR = 'h1[id], h2[id], h3[id]'

export function Preview({ content, tocOpen, baseDir, onTextSelection }: PreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const components: Components = useMemo(() => ({
    pre: ({ children, ...props }) => <PreWithCopy {...props}>{children}</PreWithCopy>,
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    // Decorative horizontal rule.
    hr: () => <div className="hr-ornament">◆  ◆  ◆</div>,
    // Resolve local/relative image paths against the open file's directory.
    img: ({ node, src, ...props }) => {
      void node
      return <img src={resolveImageSrc(typeof src === 'string' ? src : '', baseDir)} {...props} />
    },
    // Render task-list checkboxes as read-only.
    input: ({ type, checked, ...props }) => {
      if (type === 'checkbox') {
        return <input type="checkbox" checked={checked} readOnly {...props} />
      }
      return <input type={type} {...props} />
    },
  }), [baseDir])

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
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
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
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeRaw, rehypeSlug, rehypeHighlight, rehypeKatex]}
            components={components}
            urlTransform={permissiveUrlTransform}
          >
            {content}
          </Markdown>
        </article>
      </div>
    </div>
  )
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4'

type HeadingProps = React.ComponentPropsWithoutRef<HeadingTag> & { node?: unknown }

/** Heading renderer that keeps rehype-slug's `id` and adds a hover anchor. */
function makeHeading(Tag: HeadingTag) {
  return function HeadingWithAnchor({ children, id, node, ...props }: HeadingProps) {
    void node // hast metadata from react-markdown — kept out of the DOM
    return (
      <Tag id={id} {...props}>
        {children}
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

interface PreWithCopyProps {
  children: React.ReactNode
  className?: string
}

function PreWithCopy({ children, className }: PreWithCopyProps) {
  const [copied, setCopied] = useState(false)
  const codeBlock = getCodeBlockChild(children)

  if (codeBlock && isMermaidLanguage(codeBlock.props.className)) {
    return <MermaidDiagram chart={getTextContent(codeBlock.props.children).trim()} />
  }

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
