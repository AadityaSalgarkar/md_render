import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface CodeBlockProps {
  children: React.ReactNode
  className?: string
}

export function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const codeElement = document.querySelector(`[data-code-id="${className}"]`)
    const text = codeElement?.textContent || ''

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [className])

  return (
    <div className="code-block-wrapper">
      <pre className={className}>
        <code data-code-id={className}>{children}</code>
      </pre>
      <AnimatePresence mode="wait">
        <motion.button
          key={copied ? 'copied' : 'copy'}
          className={`copy-button ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          aria-label={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? 'Copied!' : 'Copy'}
        </motion.button>
      </AnimatePresence>
    </div>
  )
}
