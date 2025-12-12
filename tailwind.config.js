/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: {
          50: '#FFFDF8',
          100: '#FAF7F2',
          200: '#F5F1EA',
          300: '#E8E2D9',
          400: '#D4CCC0',
        },
        ink: {
          50: '#E8E4DC',
          100: '#9A968E',
          200: '#5C5C5C',
          300: '#3A3A3A',
          400: '#1A1A1A',
        },
        midnight: {
          50: '#2A2D35',
          100: '#1A1D23',
          200: '#121418',
          300: '#0D0F12',
          400: '#080A0C',
        },
        accent: {
          terracotta: '#C9553D',
          coral: '#E07A5F',
          forest: '#2D5A4A',
          sage: '#81B29A',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        editor: ['"IBM Plex Mono"', 'monospace'],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: '70ch',
          },
        },
      },
      boxShadow: {
        'fold': '8px 0 24px -8px rgba(0, 0, 0, 0.15)',
        'fold-dark': '8px 0 24px -8px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
}
