import { describe, expect, it } from 'vitest'
import { isPlotLanguage, preparePlotBlocks } from '../../lib/plotBlocks'
import { normalizeMath } from '../../lib/math'
import { prepareQuizBlocks } from '../../lib/quiz'

const BODY = '{\n  "plot_type": "line",\n\n  "source": { "project": "demo" }\n}'

describe('plot block pre-pass', () => {
  it('turns a tag with blank lines into one md-plot fence', () => {
    const out = preparePlotBlocks(`Intro.\n\n<plot>\n${BODY}\n</plot>\n\nAfter.`)
    expect(out).toBe(`Intro.\n\n\`\`\`md-plot\n${BODY}\n\`\`\`\n\nAfter.`)
  })

  it('handles a one-line tag and text after the closing tag', () => {
    expect(preparePlotBlocks('<plot>{"a": 1}</plot> tail')).toBe('```md-plot\n{"a": 1}\n```\n tail')
  })

  it('renames plot fences', () => {
    expect(preparePlotBlocks('```plot\n{}\n```')).toBe('```md-plot\n{}\n```')
    expect(preparePlotBlocks('~~~~ plot\n{}\n~~~~')).toBe('~~~~md-plot\n{}\n~~~~')
  })

  it('leaves a tag inside another fence alone', () => {
    const doc = '```html\n<plot>\n{}\n</plot>\n```'
    expect(preparePlotBlocks(doc)).toBe(doc)
  })

  it('leaves an unclosed tag as written', () => {
    expect(preparePlotBlocks('<plot>\n{}\n')).toBe('<plot>\n{}\n')
  })

  it('uses a longer fence when the body holds backticks', () => {
    const out = preparePlotBlocks('<plot>\n{"title": "```"}\n</plot>')
    expect(out.startsWith('````md-plot\n')).toBe(true)
    expect(out.endsWith('\n````')).toBe(true)
  })

  it('handles several blocks next to quizzes, and math leaves the JSON alone', () => {
    const doc = [
      '<plot>',
      '{"title": "\\\\(x\\\\)"}',
      '</plot>',
      '<quiz>Q<enumerate><option>a</option></enumerate></quiz>',
      '```plot',
      '{"b": 2}',
      '```',
    ].join('\n')
    const out = prepareQuizBlocks(normalizeMath(preparePlotBlocks(doc)))
    expect(out).toContain('```md-plot\n{"title": "\\\\(x\\\\)"}\n```')
    expect(out).toContain('```md-plot\n{"b": 2}\n```')
    expect(out).toContain('<md-quiz>')
  })

  it('recognises the language class', () => {
    expect(isPlotLanguage('language-md-plot')).toBe(true)
    expect(isPlotLanguage('hljs language-md-plot')).toBe(true)
    expect(isPlotLanguage('language-plot')).toBe(false)
  })
})
