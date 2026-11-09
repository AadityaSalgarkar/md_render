import type { Element, ElementContent, Root, RootContent } from 'hast'

/**
 * react-markdown renders a document as a flat stream of siblings, so a heading
 * is not the parent of its content and there is nothing to collapse. This
 * plugin nests the stream: every top-level heading is wrapped, together with
 * everything up to the next heading of the same or higher level, in
 *
 *   <section class="md-section" data-heading-id="..." data-level="N">
 *     <hN data-collapsible="true">...</hN>
 *     <div class="md-section-body">...nested content and subsections...</div>
 *   </section>
 *
 * Deeper headings nest recursively, so hiding one section body hides its
 * subsections too — the Jupyter behavior. Content before the first heading is
 * left untouched, as are headings inside blockquotes or lists (only the
 * document's top level starts sections).
 *
 * Must run after rehype-slug so headings already carry their ids.
 */

const HEADING_LEVEL = /^h([1-6])$/

function headingLevel(node: ElementContent): number | null {
  if (node.type !== 'element') return null
  const match = HEADING_LEVEL.exec(node.tagName)
  return match ? Number(match[1]) : null
}

function nest(nodes: ElementContent[]): ElementContent[] {
  const out: ElementContent[] = []
  let index = 0

  while (index < nodes.length) {
    const node = nodes[index]
    const level = headingLevel(node)

    if (node.type !== 'element' || level === null) {
      out.push(node)
      index += 1
      continue
    }

    // Collect everything belonging to this heading: siblings up to the next
    // heading of the same or a higher level.
    let end = index + 1
    while (end < nodes.length) {
      const nextLevel = headingLevel(nodes[end])
      if (nextLevel !== null && nextLevel <= level) break
      end += 1
    }

    const heading = node
    const id = heading.properties.id
    heading.properties = { ...heading.properties, dataCollapsible: 'true' }

    const body: Element = {
      type: 'element',
      tagName: 'div',
      properties: { className: ['md-section-body'] },
      children: nest(nodes.slice(index + 1, end)),
    }

    const section: Element = {
      type: 'element',
      tagName: 'section',
      properties: { className: ['md-section'], dataLevel: String(level) },
      children: [heading, body],
    }
    if (typeof id === 'string' && id) section.properties.dataHeadingId = id

    out.push(section)
    index = end
  }

  return out
}

export default function rehypeSections() {
  return (tree: Root) => {
    // SAFETY: after react-markdown the root holds only comments, elements and
    // text (no doctype), which is exactly ElementContent; every ElementContent
    // is also a RootContent.
    tree.children = nest(tree.children as ElementContent[]) satisfies RootContent[]
  }
}
