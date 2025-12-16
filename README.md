# MD_RENDER

A native macOS markdown renderer built with Tauri, React, and TypeScript. Features a split-pane editor/preview layout, syntax highlighting, math rendering, and light/dark themes.

## Features

- Native macOS app using Tauri 2.x
- Split-pane editor and preview with draggable divider
- Syntax highlighting for code blocks (highlight.js)
- Math rendering with KaTeX
- Light and dark themes with system preference detection
- Bookerly font for prose, Fira Code for code
- 70% text width for comfortable reading
- File associations for .md and .markdown files

## Installation

### From Release

1. Download `MD_RENDER.app` from releases
2. Move to `/Applications/`
3. Install the wrapper script (see below)

### Building from Source

```bash
# Clone and install dependencies
git clone <repo-url>
cd md_render
npm install

# Build and install
npm run tauri:build
cp -r src-tauri/target/release/bundle/macos/MD_RENDER.app /Applications/
```

## Wrapper Script

The wrapper script allows opening files with the app from the command line. Save this as `~/bin/mdrender`:

```bash
#!/bin/bash
if [ -z "$1" ]; then
  open -a MD_RENDER
else
  # Use realpath if available, otherwise use the file as-is
  if command -v realpath &> /dev/null; then
    FILE="$(realpath "$1")"
  else
    FILE="$1"
  fi
  TAURI_LAUNCH_FILE="$FILE" open -a MD_RENDER
fi
```

Make it executable:

```bash
chmod +x ~/bin/mdrender
```

Add `~/bin` to your PATH if not already:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Usage:

```bash
mdrender README.md
mdrender ~/.claude/plans/my-plan.md
```

## Claude Code Hooks Integration

MD_RENDER can automatically open plan files when Claude Code writes them. This is useful for reviewing plans in a readable format.

### Hook Script

Save this as `~/.claude/hooks/open-plan-in-md-render.sh`:

```bash
#!/bin/bash
# Hook to open plan files in MD_RENDER after Write tool executes

# Read JSON input from stdin
INPUT=$(cat)

# Extract file_path from tool_input using jq
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Check if file is in the plans directory
if [[ "$FILE_PATH" == ~/.claude/plans/* ]]; then
    ~/bin/mdrender "$FILE_PATH" 2>/dev/null &
fi

# Always exit 0 to not block Claude
exit 0
```

Make it executable:

```bash
chmod +x ~/.claude/hooks/open-plan-in-md-render.sh
```

### Claude Settings Configuration

Add this to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/YOUR_USERNAME/.claude/hooks/open-plan-in-md-render.sh"
          }
        ]
      }
    ]
  }
}
```

Replace `YOUR_USERNAME` with your actual username.

Now whenever Claude Code writes a file to `~/.claude/plans/`, it will automatically open in MD_RENDER.

## Setting as Default App

To set MD_RENDER as the default app for markdown files:

```bash
# Install duti
brew install duti

# Set as default for .md and .markdown files
duti -s com.mdrender.app .md all
duti -s com.mdrender.app .markdown all
```

Or manually: Right-click any .md file > Get Info > Open with > MD_RENDER > Change All...

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Tauri 2.x (Rust)
- **Styling**: Tailwind CSS, CSS custom properties
- **Markdown**: react-markdown, remark-gfm, rehype-highlight
- **Math**: KaTeX (rehype-katex, remark-math)
- **Fonts**: Bookerly (prose), Fira Code Nerd Font (code)

## Development

```bash
# Start development server
npm run tauri:dev

# Build for production
npm run tauri:build

# Run frontend only (browser)
npm run dev
```

## Project Structure

```
md_render/
├── src/                    # React frontend
│   ├── components/         # React components
│   ├── hooks/              # Custom hooks
│   ├── lib/                # Utilities
│   ├── App.tsx             # Main app component
│   └── index.css           # Styles and themes
├── src-tauri/              # Tauri backend (Rust)
│   ├── src/lib.rs          # Rust commands
│   ├── tauri.conf.json     # Tauri configuration
│   ├── Info.plist          # macOS file associations
│   └── Cargo.toml          # Rust dependencies
├── bin/
│   └── mdrender            # Wrapper script
└── package.json
```

## License

MIT
