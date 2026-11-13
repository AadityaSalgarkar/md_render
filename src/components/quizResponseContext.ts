import { createContext } from 'react'

/** The document's written quiz answers, and how to save one back into it. */
export interface QuizResponses {
  /** One per `<response>`, in document order (see readQuizResponses). */
  values: string[]
  /** Absent where the document cannot be written. */
  save?: (index: number, text: string) => Promise<void>
}

export const QuizResponseContext = createContext<QuizResponses>({ values: [] })
