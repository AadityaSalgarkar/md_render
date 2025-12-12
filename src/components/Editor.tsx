import { useCallback, useRef, useEffect } from 'react'

interface EditorProps {
  value: string
  onChange: (value: string) => void
}

export function Editor({ value, onChange }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }, [onChange])

  // Handle tab key for indentation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      const newValue = value.substring(0, start) + '  ' + value.substring(end)
      onChange(newValue)

      // Restore cursor position
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      })
    }
  }, [value, onChange])

  // Focus editor on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="editor-container h-full overflow-hidden">
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Start writing your markdown here..."
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
      />
    </div>
  )
}
