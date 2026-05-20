import type { ThemeDefinition } from '../lib/themes'

/** Active theme id (see `src/lib/themes.ts`). */
export type Theme = string

export interface ThemeContextType {
  themeId: Theme
  theme: ThemeDefinition
  setTheme: (id: Theme) => void
}

/** A heading lifted from the rendered preview, used to build the index. */
export interface Heading {
  id: string
  text: string
  level: number
}
