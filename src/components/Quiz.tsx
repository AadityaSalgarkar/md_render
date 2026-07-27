import { Children, createContext, isValidElement, useContext, useState } from 'react'

/**
 * Renderers for the <quiz> authoring tag (rewritten to md-quiz / md-enumerate /
 * md-option by src/lib/quiz.ts before parsing). The question is always
 * visible; the options stay out of the DOM until the eye button reveals them.
 */

interface QuizState {
  revealed: boolean
  reveal: () => void
}

const QuizContext = createContext<QuizState | null>(null)

type TagProps = { children?: React.ReactNode; node?: unknown }

export function Quiz({ children, node }: TagProps) {
  void node
  const [revealed, setRevealed] = useState(false)

  return (
    <QuizContext.Provider value={{ revealed, reveal: () => setRevealed(true) }}>
      <div className="quiz-card">
        <div className="quiz-header">
          <span className="quiz-kicker">Quiz</span>
          <button
            type="button"
            className="quiz-eye"
            aria-expanded={revealed}
            aria-label={revealed ? 'Hide options' : 'Reveal options'}
            title={revealed ? 'Hide options' : 'Reveal options'}
            onClick={() => setRevealed((prev) => !prev)}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <div className="quiz-body">{children}</div>
      </div>
    </QuizContext.Provider>
  )
}

export function Enumerate({ children, node }: TagProps) {
  void node
  const quiz = useContext(QuizContext)

  // Outside a quiz there is nothing to hide — render the options plainly.
  if (!quiz) return <ol className="quiz-options">{children}</ol>

  if (!quiz.revealed) {
    const count = countOptions(children)
    return (
      <button type="button" className="quiz-hidden-row" onClick={quiz.reveal}>
        {count > 0 ? `${count} option${count === 1 ? '' : 's'} hidden` : 'options hidden'}
      </button>
    )
  }

  return <ol className="quiz-options">{children}</ol>
}

export function Option({ children, node }: TagProps) {
  void node
  return <li className="quiz-option">{children}</li>
}

/** Count md-option children, ignoring whitespace text between tags. */
function countOptions(children: React.ReactNode): number {
  return Children.toArray(children).filter(
    (child) => isValidElement(child) && child.type === Option,
  ).length
}

/* Same eye the app uses for its Read control. */
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
