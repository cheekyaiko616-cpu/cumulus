#!/usr/bin/env python3
"""index.html に書かれた css・js を1ファイルにまとめる（動作確認・プレビュー用）。
  python3 tools/build.py                 → dist/preview.html（そのまま開ける完全なHTML）
  python3 tools/build.py out.html --fragment  → 共有ページ用（<html>や<head>を持たない形）
GitHub Pages に置くときは、このビルドは不要（index.html とフォルダをそのまま公開する）。"""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith("--")]
fragment = "--fragment" in sys.argv
out = pathlib.Path(args[0]) if args else root / "dist" / "preview.html"
src = (root / "index.html").read_text(encoding="utf8")
read = lambda p: (root / p).read_text(encoding="utf8")
css = "\n".join(read(h) for h in re.findall(r'<link rel="stylesheet" href="((?:css)/[^"]+)">', src))
js_files = re.findall(r'<script src="([^"]+)"></script>', src)
js = "\n".join(re.sub(r'^"use strict";\n', "", read(j)) for j in js_files)
body = re.search(r"<body>(.*)</body>", src, re.S).group(1)
body = re.sub(r'<script src="[^"]+"></script>\n?', "", body).strip()
title = re.search(r"<title>.*?</title>", src).group(0)
font = re.search(r'<link rel="stylesheet" href="https://fonts[^>]*>', src).group(0)
assert "</script" not in js
if fragment:
    page = f'{title}\n<meta name="claude:viewport-fit-sides" content="cover">\n{font}\n<style>\n{css}\n</style>\n\n{body}\n\n<script>\n"use strict";\n{js}\n</script>\n'
else:
    page = f'<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{title}\n{font}\n<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n<script>\n"use strict";\n{js}\n</script>\n</body>\n</html>\n'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(page, encoding="utf8")
print("書き出しました:", out, f"({len(page):,} 文字)")
