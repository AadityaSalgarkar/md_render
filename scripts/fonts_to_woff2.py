"""Subset OpenType fonts to the scripts a document needs and save them as woff2.

Used for the LaTeX theme's bundled New Computer Modern faces:

    uv run --with fonttools --with brotli scripts/fonts_to_woff2.py SRC_DIR OUT_DIR NAME...

Each NAME is a file stem in SRC_DIR (NewCM10-Book reads NewCM10-Book.otf and
writes NewCM10-Book.woff2). The kept ranges cover Latin (with the extended
blocks), Greek, punctuation, currency, letterlike symbols, arrows, the math
operators and the f-ligatures; Cyrillic and the rest of the font's very wide
coverage fall back to the next face in the stack.
"""

import sys
from pathlib import Path

from fontTools import subset

UNICODES = [
    (0x0000, 0x024F),  # Basic Latin to Latin Extended-B
    (0x0250, 0x02FF),  # IPA extensions, spacing modifiers
    (0x0300, 0x036F),  # Combining diacritics
    (0x0370, 0x03FF),  # Greek
    (0x1E00, 0x1EFF),  # Latin Extended Additional
    (0x2000, 0x206F),  # General punctuation
    (0x20A0, 0x20CF),  # Currency
    (0x2100, 0x214F),  # Letterlike symbols
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Mathematical operators
    (0xFB00, 0xFB06),  # Latin ligatures
]


def convert(source: Path, target: Path) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    font = subset.load_font(str(source), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[c for low, high in UNICODES for c in range(low, high + 1)])
    subsetter.subset(font)
    subset.save_font(font, str(target), options)


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit("usage: fonts_to_woff2.py SRC_DIR OUT_DIR NAME...")
    source_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[3:]:
        source = source_dir / f"{name}.otf"
        target = out_dir / f"{name}.woff2"
        convert(source, target)
        print(f"{target.name}: {source.stat().st_size // 1024} KB -> {target.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
