import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { themes as builtins, type ThemeDefinition } from '../lib/themes'
import { checkPackages, type LoadedPackage } from '../lib/themePackages'

const ROOT = path.resolve(__dirname, '../../themes')

/** Every package in ./themes, checked the way the app checks installed ones. */
export function bundledPackages(): LoadedPackage[] {
  const raw = readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      package: entry.name,
      themes: JSON.parse(readFileSync(path.join(ROOT, entry.name, 'theme.json'), 'utf8')).themes,
      css: false,
    }))
    .sort((a, b) => a.package.localeCompare(b.package))
  return checkPackages(raw, () => null)
}

/** The built-ins plus every theme of every package: all seventeen. */
export function allThemes(): ThemeDefinition[] {
  return [...builtins, ...bundledPackages().flatMap((p) => p.themes)]
}
