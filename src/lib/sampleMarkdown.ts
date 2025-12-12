export const sampleMarkdown = `# Welcome to Literary Atelier

A **refined** markdown editor inspired by premium book typography and vintage printing presses.

## Features

This editor supports all standard markdown plus **GitHub Flavored Markdown** extensions:

### Text Formatting

You can write *italic*, **bold**, ***bold italic***, and ~~strikethrough~~ text. You can also use \`inline code\` for technical terms.

### Blockquotes

> "The art of writing is the art of discovering what you believe."
>
> — Gustave Flaubert

### Lists

#### Unordered
- Fresh parchment paper
- Rich black ink
- Elegant serif typography
- Monospace code blocks

#### Ordered
1. Write your thoughts
2. Preview the rendered output
3. Refine and iterate
4. Publish with confidence

#### Task Lists
- [x] Initialize the editor
- [x] Configure markdown parsing
- [ ] Write something brilliant
- [ ] Change the world

### Code Blocks

Here's some JavaScript with syntax highlighting:

\`\`\`javascript
function greet(name) {
  const message = \`Hello, \${name}!\`;
  console.log(message);
  return message;
}

greet('World');
\`\`\`

And some Python:

\`\`\`python
def fibonacci(n):
    """Generate Fibonacci sequence up to n."""
    a, b = 0, 1
    while a < n:
        yield a
        a, b = b, a + b

list(fibonacci(100))
\`\`\`

### Tables

| Feature | Status | Notes |
|---------|--------|-------|
| Headers | ✓ | All levels H1-H6 |
| Emphasis | ✓ | Bold, italic, strikethrough |
| Lists | ✓ | Ordered, unordered, tasks |
| Code | ✓ | Inline and blocks |
| Tables | ✓ | With alignment |
| Links | ✓ | Auto-linked URLs |

### Links & Images

Visit [GitHub](https://github.com) for more information.

URLs are auto-linked: https://example.com

### Horizontal Rule

---

### Mathematics

This editor supports **LaTeX math** via KaTeX. Use \`$...$\` for inline and \`$$...$$\` for display mode.

**Inline math**: Einstein's famous equation $E = mc^2$ changed physics forever.

**The Quadratic Formula**:

$$
x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$

**Euler's Identity** — often called the most beautiful equation:

$$
e^{i\\pi} + 1 = 0
$$

**A Gaussian Integral**:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

**The Basel Problem** — solved by Euler:

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

---

*Start writing in the editor on the left, and watch your prose transform into beautifully typeset text on the right.*
`
