"""Lossless WOFF2 packaging of the pinned OFL Noto Sans SC variable font.

Development-only: fontTools 4.68.0 / Brotli 1.2.1; no glyph subsetting or online font loading.
Source: google/fonts@6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/notosanssc/NotoSansSC[wght].ttf
"""
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path('.tmp/font-tools').resolve()))
from fontTools.ttLib import TTFont

source = Path('.tmp/NotoSansSC-variable.ttf')
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'
font = TTFont(source, recalcTimestamp=False)
font.flavor = 'woff2'
out = Path('apps/desktop/src/renderer/src/assets/fonts/NotoSansSC-variable.woff2')
font.save(out)
record = {'source': 'https://github.com/google/fonts/blob/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf', 'license': 'OFL-1.1', 'conversion': 'fontTools 4.68.0 / Brotli 1.2.1, WOFF2 compression, no glyph subsetting', 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'woff2Sha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'bytes': out.stat().st_size, 'axes': [{'tag': a.axisTag, 'min': a.minValue, 'default': a.defaultValue, 'max': a.maxValue} for a in font['fvar'].axes], 'unicodeCodepoints': len(font.getBestCmap())}
out.with_name('SOURCE.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
print(json.dumps(record, indent=2))
