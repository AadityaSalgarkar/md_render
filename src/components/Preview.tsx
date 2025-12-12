import { useMemo, useState, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { Components } from 'react-markdown'

interface PreviewProps {
  content: string
}

export function Preview({ content }: PreviewProps) {
  const components: Components = useMemo(() => ({
    pre: ({ children, ...props }) => {
      return <PreWithCopy {...props}>{children}</PreWithCopy>
    },
    // Custom hr with Victorian ornament
    hr: () => {
      return <div className="hr-ornament">◆  ◆  ◆</div>
    },
    // Ensure checkboxes in task lists are properly styled
    input: ({ type, checked, ...props }) => {
      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            {...props}
          />
        )
      }
      return <input type={type} {...props} />
    },
  }), [])

  return (
    <div className="preview-container h-full overflow-auto">
      <article className="markdown-body animate-fade-in">
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeHighlight, rehypeKatex]}
          components={components}
        >
          {content}
        </Markdown>
      </article>
    </div>
  )
}

interface PreWithCopyProps {
  children: React.ReactNode
  className?: string
}

function PreWithCopy({ children, className }: PreWithCopyProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    // Extract text content from children
    const getTextContent = (node: React.ReactNode): string => {
      if (typeof node === 'string') return node
      if (typeof node === 'number') return String(node)
      if (!node) return ''
      if (Array.isArray(node)) return node.map(getTextContent).join('')
      if (typeof node === 'object' && 'props' in node) {
        return getTextContent((node as React.ReactElement).props.children)
      }
      return ''
    }

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
