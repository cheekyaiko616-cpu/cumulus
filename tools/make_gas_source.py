#!/usr/bin/env python3
"""tools/apps-script/Code.gs を、アプリの「スクリプトをコピー」で使う js/core/gas-source.js に写す。
Code.gs を直したら、これを実行する。"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "tools" / "apps-script" / "Code.gs").read_text(encoding="utf8")
(root / "js" / "core" / "gas-source.js").write_text(
    '"use strict";\n// tools/apps-script/Code.gs の写し（tools/make_gas_source.py で作る。直接は直さない）\nconst GAS_SOURCE = ' + json.dumps(src, ensure_ascii=False) + ";\n", encoding="utf8")
print("書き出しました: js/core/gas-source.js")
