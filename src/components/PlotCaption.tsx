import Markdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

/** Block-level markup has no place in a caption; its text is kept inline. */
const BLOCK_ELEMENTS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'table', 'pre', 'ul', 'ol', 'li', 'blockquote', 'hr']

const components: Components = {
  p: ({ children }) => <>{children}</>,
}

/**
 * A figure caption as in a paper: "Figure N:" followed by the lesson the
 * plot shows. The number comes from a CSS counter over the document's
 * plots, so it follows document order with no bookkeeping. Inline markdown
 * and `$math$` work; anything block-level is flattened to its text.
 */
export function PlotCaption({ text }: { text: string }) {
  return (
    <figcaption className="experiment-plot-label">
      <span className="experiment-plot-label-text">
        <Markdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          disallowedElements={BLOCK_ELEMENTS}
          unwrapDisallowed
          components={components}
        >
          {text}
        </Markdown>
      </span>
    </figcaption>
  )
}
