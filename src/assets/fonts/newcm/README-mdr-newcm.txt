MDR New Computer Modern: subsets of New Computer Modern for MD_RENDER

These files are MODIFIED versions of fonts from New Computer Modern 8.x by
Antonis Tsolomitis, distributed under the GUST Font License
(GUST-FONT-LICENSE.txt, which is the LaTeX Project Public License 1.3c plus
a naming request). Following that request, they carry new file names and
are loaded under the family name "MDR New Computer Modern".

Manifest (modified file <- original):
  mdr-newcm10-book.woff2         <- NewCM10-Book.otf
  mdr-newcm10-bookitalic.woff2   <- NewCM10-BookItalic.otf
  mdr-newcm10-bold.woff2         <- NewCM10-Bold.otf
  mdr-newcm10-bolditalic.woff2   <- NewCM10-BoldItalic.otf
  mdr-newcmmono10-book.woff2     <- NewCMMono10-Book.otf

The only change: each font is subset to Latin, Greek, punctuation,
currency, letterlike symbols, arrows, the mathematical operators and the
f-ligatures, and saved as woff2, by scripts/fonts_to_woff2.py. All five
originals are under the GUST license, not the GPL parts of the package.

The unmodified fonts: https://ctan.org/pkg/newcomputermodern
