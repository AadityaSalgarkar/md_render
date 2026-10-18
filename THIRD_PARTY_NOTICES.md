# Third-party notices

## Themes

Four of MD_RENDER's themes, each in a light and a dark variant, follow Typora
themes. MD_RENDER does not include their stylesheets. Its themes are its own
CSS variables (`src/lib/themes.ts`) and rules (`src/index.css`), written to
match the look of each theme's reading area: palette, faces, and
typographic choices.

| MD_RENDER theme | After | Author | Licence |
|---|---|---|---|
| Claude, `claude` / `claude-dark` | [claude-typora-theme](https://github.com/Tsumugii24/claude-typora-theme) | Tsumugii24 | MIT |
| Sonnet, `sonnet` / `sonnet-dark` | [sonnet](https://github.com/bexino/sonnet), built on [typora_claude](https://github.com/blaxisomu/typora_claude) | bexino (blaxisomu) | Apache-2.0 (none stated upstream) |
| Claudette, `claudette` / `claudette-dark` | [typora-theme-claudette](https://github.com/CookPiu/typora-theme-claudette) | CookPiu | MIT |
| LaTeX, `latex` / `latex-dark` | [LatexTypora](https://github.com/shamsghi/LatexTypora) (LaTeX-Typora-V2) | shamsghi | Apache-2.0 |

The Claude Typora theme bundles Anthropic's web fonts. Its own notice says
they are not relicensed, so MD_RENDER neither ships nor loads them. The
Claude theme reads in Lora, loaded from Google Fonts, under the SIL Open Font
License.

## Fonts

- **New Computer Modern** by Antonis Tsolomitis, under the GUST Font License
  (the LaTeX Project Public License 1.3c). The LaTeX theme uses modified
  subsets of five faces, renamed as the licence requests:
  `src/assets/fonts/newcm/`, with its manifest in `README-mdr-newcm.txt` and
  the licence in `GUST-FONT-LICENSE.txt`. The originals:
  https://ctan.org/pkg/newcomputermodern
- Other theme faces (Lora, Inter, Source Serif 4, JetBrains Mono, Literata,
  and the rest of the `index.html` list) load from Google Fonts, each under
  its own open licence. KaTeX's fonts ship with the `katex` package (MIT).
