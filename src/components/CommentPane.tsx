import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatThread } from '../lib/comments'

interface CommentPaneProps {
  open: boolean
  selectedText: string | null
  threads: ChatThread[]
  saveState: string | null
  exportState: string | null
  onSave: (comment: string) => Promise<void> | void
  onRefresh: () => Promise<void> | void
  onExport: () => Promise<void> | void
  onClose: () => void
}

export function CommentPane({
  open,
  selectedText,
  threads,
  saveState,
  exportState,
  onSave,
  onRefresh,
  onExport,
  onClose,
}: CommentPaneProps) {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (selectedText) setDraft('')
  }, [selectedText])

  if (!open) return null

  const canSave = Boolean(selectedText && draft.trim())

  const handleSave = async () => {
    if (!canSave) return
    await onSave(draft)
    setDraft('')
  }

  const handleDone = async () => {
    await onRefresh()
    onClose()
  }

  return (
    <aside className="comment-pane" aria-label="Comments">
      <header className="comment-pane-header">
        <div>
          <div className="comment-pane-kicker">Review thread</div>
          <h2>Comments</h2>
        </div>
        <button className="comment-close-button" type="button" onClick={handleDone} aria-label="Close comments">
          Done
        </button>
      </header>

      <section className="comment-composer" aria-label="Add comment">
        <div className="comment-target-label">Selection</div>
        {selectedText ? (
          <blockquote className="comment-target">{selectedText}</blockquote>
        ) : (
          <p className="comment-empty">Highlight text in the rendered document to attach a comment.</p>
        )}

        <textarea
          className="comment-textarea"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a comment for the selected passage..."
          aria-label="Comment text"
          disabled={!selectedText}
        />
        <button
          className="comment-primary-button"
          type="button"
          onClick={handleSave}
          disabled={!canSave}
        >
          Save comment
        </button>
        {saveState && <p className="comment-status">{saveState}</p>}
      </section>

      <section className="comment-toolbar" aria-label="Comment actions">
        <button type="button" onClick={onRefresh}>Refresh</button>
        <button type="button" onClick={onExport}>Export clean .md</button>
      </section>
      {exportState && <p className="comment-status">{exportState}</p>}

      <section className="comment-thread-list" aria-label="Saved comments">
        {threads.length === 0 ? (
          <p className="comment-empty">No saved comments in this document yet.</p>
        ) : (
          threads.map((thread, index) => (
            <article className="comment-thread" key={thread.id}>
              <div className="comment-thread-index">{index + 1}</div>
              <div className="comment-thread-body">
                <div className="comment-thread-label">Comment</div>
                <Markdown remarkPlugins={[remarkGfm]}>{thread.comment || '_Empty comment_'}</Markdown>
                {thread.responses.length > 0 && (
                  <div className="comment-response-stack">
                    <div className="comment-thread-label">LLM response</div>
                    {thread.responses.map((response, responseIndex) => (
                      <div className="comment-response" key={`${thread.id}-${responseIndex}`}>
                        <Markdown remarkPlugins={[remarkGfm]}>{response}</Markdown>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </aside>
  )
}
