#!/usr/bin/env python3
"""コードの分け方が守られているかを調べる（標準ライブラリだけで動く）。

  python3 tools/check_structure.py            … 検査（問題があれば終了コード1）
  python3 tools/check_structure.py --report   … 数字の一覧（ファイル数・行数・名前の重複・未使用など）を出す

調べること（エラー）
  1. js/ の全ファイルが index.html に書かれ、書かれたファイルが実在する
  2. 各ファイルの先頭に、役割・依存・実行時・公開の説明がある
  3. 階層（core → ui → features → main）で、下の層が上の層を使っていない
  4. 「依存」に書いたファイルが、先に読み込まれる順番になっている
  5. 使っているファイルが「依存」か「実行時」に書かれている（書き忘れがない）
  6. 「公開」に書いた名前が実在し、他のファイルから使われている名前が漏れなく書かれている
  7. core は画面（DOM）に触れない
  8. 同じ名前を、複数のファイルで定義していない
  9. CSS で使っている変数（--xxx）が、定義されている
調べること（注意だけ）
  - 使われていない class（CSS）／使われていない関数・定数（JS）／書いたのに使っていない依存
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LAYERS = {"core": 0, "ui": 1, "features": 2}          # js/main.js は一番上（3）
SKIP_FILES = {"js/core/gas-source.js"}                  # 自動で作るファイル（検査の対象外。名前だけ数える）
# 試験のプログラムが外から呼ぶ名前（アプリの中で使われていなくても、未使用とは数えない）
TEST_HOOKS = set("""renderAll save persist reindex load normalize freshState sampleState leaveSample runMail planImport applyImport
fetchMail validItem autoMail showTab openDay openEdit openInv openCard openPicker syncPickers moveMonth renderCalendar renderInvest
renderSummary renderSettings renderMail renderMonthList rangeStats monthStats isSavedDay parseReceipt looksSensitive toInt amtText lastKey
addDays dayNo daysBetween todayStr cycleEnd cycleStart payDateOf makeCard normInvests normMail findMailMatch setPay rowHtml updateTotal
updateCardHint updateMatch openOv closeOv openStack armed toast refreshIfNewDay scheduleMidnight state byDate pays paysByDate KEY storageOk
dirty RENDER tab period customFrom customTo invMode invFrom invTo invAnchor sumAnchor viewYear viewMonth dayKey matchMode mailBlocked
mailTryAt lastToday midnightTimer entryHtml renderDay renderNextPay renderCardList readRows editing editPay ocrBusy mailBusy""".split())

def read(p):
    return (ROOT / p).read_text(encoding="utf8")

def strip_js(src):
    """コメントと文字列の中身を空にする（構造だけ残す）。正規表現リテラルは / ... / を残す。"""
    out, i, n = [], 0, len(src)
    prev = ""                                           # 直前の意味のある文字（正規表現か割り算かの判定用）
    while i < n:
        c = src[i]
        if src.startswith("//", i):
            j = src.find("\n", i); i = n if j < 0 else j; continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        if c in "\"'`":
            q = c; j = i + 1
            while j < n and src[j] != q:
                j += 2 if src[j] == "\\" else 1
            out.append(q + q); i = j + 1; prev = q; continue
        if c == "/" and prev in "(,=:[!&|?{};\n" + "":
            j = i + 1; inc = False
            while j < n and (src[j] != "/" or inc) and src[j] != "\n":
                if src[j] == "\\": j += 1
                elif src[j] == "[": inc = True
                elif src[j] == "]": inc = False
                j += 1
            out.append("/ /"); i = j + 1
            while i < n and src[i].isalpha(): i += 1
            prev = "/"; continue
        out.append(c)
        if not c.isspace(): prev = c
        i += 1
    return "".join(out)

def split_top(s, sep=","):
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch in "([{": depth += 1
        elif ch in ")]}": depth -= 1
        if ch == sep and depth == 0:
            parts.append("".join(cur)); cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur)); return parts

def top_names(code):
    """行頭（0桁目）で宣言された名前を集める。"""
    names = []
    for m in re.finditer(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", code, re.M):
        names.append(m.group(1))
    for m in re.finditer(r"^(?:const|let|var)\s+", code, re.M):
        j = m.end(); depth = 0; k = j
        while k < len(code):
            ch = code[k]
            if ch in "([{": depth += 1
            elif ch in ")]}": depth -= 1
            elif ch == ";" and depth == 0: break
            k += 1
        for part in split_top(code[j:k]):
            part = part.strip()
            d = re.match(r"\[([^\]]*)\]", part)
            if d:
                names += [x.strip() for x in d.group(1).split(",") if re.match(r"^[A-Za-z_$][\w$]*$", x.strip())]
                continue
            nm = re.match(r"([A-Za-z_$][\w$]*)", part)
            if nm: names.append(nm.group(1))
    return names

def local_names(code):
    """関数の中（行頭以外）で宣言された名前・引数名。グローバルの名前と紛れるものを見分けるために使う。"""
    loc = set()
    for m in re.finditer(r"[ \t]+(?:const|let|var)\s+([^;=]+?)(?:=|;|\bof\b|\bin\b)", code):
        for x in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)): loc.add(x)
    for m in re.finditer(r"(?:const|let|var)\s+(?:\[([^\]]*)\]|\{([^}]*)\})", code):
        for g in m.groups():
            if g:
                for x in re.findall(r"[A-Za-z_$][\w$]*", g): loc.add(x)
    for m in re.finditer(r"function\s*[\w$]*\s*\(([^)]*)\)", code):
        for x in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)): loc.add(x)
    for m in re.finditer(r"\(([^()]*)\)\s*=>", code):
        for x in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)): loc.add(x)
    for m in re.finditer(r"([A-Za-z_$][\w$]*)\s*=>", code): loc.add(m.group(1))
    for m in re.finditer(r"catch\s*\(\s*([\w$]+)", code): loc.add(m.group(1))
    return loc

def words(code):
    for m in re.finditer(r"(?<![\w$.])([A-Za-z_$][\w$]*)", code):
        # オブジェクトのキー（名前: 値）は使用とみなさない
        after = code[m.end():m.end() + 2].lstrip()
        if after.startswith(":") and not after.startswith("::"):
            before = code[max(0, m.start() - 2):m.start()].strip()
            if before in ("{", ",", ""):
                continue
        yield m.group(1)

def main():
    report = "--report" in sys.argv
    errors, warns = [], []
    index = read("index.html")
    listed = re.findall(r'<script src="(js/[^"]+)"', index)
    on_disk = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "js").rglob("*.js"))
    for f in on_disk:
        if f not in listed: errors.append(f"{f} が index.html に書かれていません")
    for f in listed:
        if f not in on_disk: errors.append(f"{f} が index.html に書かれていますが、ファイルがありません")
    if len(set(listed)) != len(listed): errors.append("index.html に同じ script が2回書かれています")

    def layer(f):
        parts = f.split("/")
        return LAYERS.get(parts[1], 3) if len(parts) > 2 else 3
    order = {f: i for i, f in enumerate(listed)}

    info = {}
    for f in on_disk:
        raw = read(f); code = strip_js(raw)
        head = [l for l in raw.split("\n")[:14] if l.startswith("//")]
        info[f] = dict(raw=raw, code=code, head=head, lines=len(raw.split("\n")), names=top_names(code))
    # 名前の重複
    owner = {}
    for f in on_disk:
        for nm in info[f]["names"]:
            if nm in owner and owner[nm] != f: errors.append(f"名前「{nm}」が {owner[nm]} と {f} の両方で定義されています")
            owner.setdefault(nm, f)
        seen = set()
        for nm in info[f]["names"]:
            if nm in seen: errors.append(f"名前「{nm}」が {f} の中で2回定義されています")
            seen.add(nm)
    locals_all = set()
    for f in on_disk: locals_all |= local_names(info[f]["code"])
    ambiguous = {n for n in owner if n in locals_all and len(n) <= 3}   # 短い名前で、関数の中の変数と紛れるものは使用判定から外す
    # 使用関係
    used_by = {f: {} for f in on_disk}           # f が使う他ファイルの名前
    users_of = {n: set() for n in owner}         # 名前を使うファイル
    for f in on_disk:
        if f in SKIP_FILES: continue
        mine = set(info[f]["names"])
        for w in set(words(info[f]["code"])):
            if w in owner and w not in mine and w not in ambiguous and owner[w] != f:
                used_by[f].setdefault(owner[w], set()).add(w)
                users_of[w].add(f)
    # 1ファイルずつ検査
    for f in on_disk:
        if f in SKIP_FILES: continue
        h = "\n".join(info[f]["head"])
        if not re.search(r"^// =====.*=====", h, re.M): errors.append(f"{f}: 先頭に「// ===== 題名 =====」の行がありません")
        fields = {}
        for key in ("役割", "依存", "実行時", "公開"):
            m = re.search(r"^// " + key + r"[:：]\s*(.*)$", h, re.M)
            if not m: errors.append(f"{f}: 先頭の説明に「{key}:」の行がありません")
            else: fields[key] = m.group(1).strip()
        if len(fields) < 4: continue
        def files_of(s):
            if s in ("", "なし", "（なし）"): return []
            return [x.strip() for x in s.split(",") if x.strip()]
        by_base = {}
        for g in on_disk: by_base.setdefault(g.split("/")[-1], []).append(g)
        def resolve(x):                              # 「util.js」のようにファイル名だけでも書ける（同じ名前が複数あるときは、フォルダ付きで書く）
            if x in on_disk: return x
            if len(by_base.get(x, [])) == 1: return by_base[x][0]
            errors.append(f"{f}: 「{x}」という依存先のファイルがないか、同じ名前のファイルが複数あります（フォルダ付きで書いてください）"); return None
        dep = [r for r in map(resolve, files_of(fields["依存"])) if r]; run = [r for r in map(resolve, files_of(fields["実行時"])) if r]
        pub = [x for x in re.split(r"[,、\s]+", fields["公開"]) if x and x not in ("なし", "（なし）")]
        for d in dep:
            if d in order and f in order and order[d] >= order[f]: errors.append(f"{f}: 依存「{d}」が、このファイルより後に読み込まれます（index.html の順番を直してください）")
        for g, ns in used_by[f].items():
            if g in dep or g in run: continue
            errors.append(f"{f}: {g} の {', '.join(sorted(ns)[:4])} を使っていますが、「依存」にも「実行時」にも書かれていません")
        for g in dep + run:
            if g in on_disk and g not in used_by[f] and g not in SKIP_FILES: warns.append(f"{f}: 「{g}」を依存に書いていますが、使っていません")
        lf = layer(f)
        for g in used_by[f]:
            if layer(g) > lf: errors.append(f"{f}: 下の層（{f.split('/')[1] if lf < 3 else 'main'}）が、上の層の {g} を使っています（階層は core → ui → features → main）")
        # 公開
        mine = set(info[f]["names"])
        for nm in pub:
            if nm not in mine: errors.append(f"{f}: 「公開」に書いた {nm} が、このファイルにありません")
        outside = {nm for nm in mine if users_of.get(nm, set()) - {f}}
        for nm in sorted(outside - set(pub)): errors.append(f"{f}: {nm} は他のファイルから使われていますが、「公開」に書かれていません")
        for nm in pub:
            if nm in mine and nm not in outside and nm not in TEST_HOOKS: warns.append(f"{f}: 「公開」の {nm} は、他のファイルから使われていません")
        # core は画面に触れない
        if f.startswith("js/core/"):
            for pat, label in ((r"\bdocument\b", "document"), (r"\bwindow\b", "window"), (r"\$\(", "$("), (r"getElementById|querySelector", "DOM検索"),
                               (r"\binnerHTML\b|\binnerText\b|\btextContent\b", "画面の書き換え"), (r"addEventListener|\.onclick|\.onchange", "イベント")):
                if re.search(pat, info[f]["code"]): errors.append(f"{f}: core が画面（DOM）に触れています（{label}）。画面の処理は ui/ か features/ に置いてください")
    # 未使用（注意）
    for nm, f in sorted(owner.items()):
        if f in SKIP_FILES or nm in TEST_HOOKS: continue
        if not (users_of[nm] - {f}):
            # 自分のファイルの中だけで使われていれば問題なし。1回も使われていなければ未使用
            cnt = len(re.findall(r"(?<![\w$.])" + re.escape(nm) + r"(?![\w$])", info[f]["code"]))
            if cnt <= 1 and nm not in ("GAS_SOURCE",): warns.append(f"{f}: {nm} は、どこからも使われていません（不要なら消してください）")
    # CSS
    css_files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "css").glob("*.css"))
    for f in re.findall(r'<link rel="stylesheet" href="(css/[^"]+)"', index):
        if f not in css_files: errors.append(f"{f} が index.html に書かれていますが、ファイルがありません")
    for f in css_files:
        if f not in index: errors.append(f"{f} が index.html に書かれていません")
    css_text = {f: re.sub(r"/\*.*?\*/", "", read(f), flags=re.S) for f in css_files}
    all_css = "\n".join(css_text.values())
    defined = set(re.findall(r"(--[\w-]+)\s*:", all_css)); used_vars = set(re.findall(r"var\((--[\w-]+)", all_css + index))   # index.html のスプライト（SVG）の中の var(--…) も使用に数える
    for v in sorted(used_vars - defined): errors.append(f"CSS: {v} を使っていますが、どこにも定義がありません")
    dynamic = {"--cash", "--code", "--credit"}   # payColor() が「var(--」＋支払い方法の名前で作る色
    for v in sorted(defined - used_vars - dynamic): warns.append(f"CSS: {v} は定義だけで、使われていません")
    tokens = set()
    for m in re.finditer(r'class="([^"]*)"', index): tokens |= set(m.group(1).split())
    for f in on_disk:
        if f in SKIP_FILES: continue
        for m in re.finditer(r"\"((?:[^\"\\\n]|\\.)*)\"|'((?:[^'\\\n]|\\.)*)'", info[f]["raw"]):
            tokens |= set(re.findall(r"[A-Za-z_][\w-]*", m.group(1) or m.group(2) or ""))
    classes = {}
    for f in css_files:
        for m in re.finditer(r"([^{}]+)\{", css_text[f]):
            pre = m.group(1).strip()
            if pre.startswith("@") or re.match(r"^(from|to|\d+%)", pre): continue
            pre = re.sub(r"\[[^\]]*\]", "", pre)
            for c in re.findall(r"\.([A-Za-z_][\w-]*)", pre): classes.setdefault(c, f)
    unused_classes = [c for c in sorted(classes) if c not in tokens]
    for c in unused_classes: warns.append(f"{classes[c]}: class「{c}」は、index.html にも JS にも出てきません（不要なら消してください）")
    dups = []
    for f in css_files:                           # 同じ選択子が、入れ子の外で2回以上書かれている
        flat = css_text[f]
        while True:                                # @media・@keyframes などの入れ子を、中身ごと取り除く
            m = re.search(r"@[\w-]+[^{};]*\{", flat)
            if not m: break
            depth, j = 1, m.end()
            while j < len(flat) and depth:
                depth += (flat[j] == "{") - (flat[j] == "}"); j += 1
            flat = flat[:m.start()] + flat[j:]
        seen = {}
        for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", flat):
            sel = " ".join(m.group(1).split())
            if sel in seen: dups.append((f, sel))
            seen[sel] = 1
    for f, sel in dups: warns.append(f"{f}: 選択子「{sel}」が2回書かれています（まとめられます）")

    if report:
        js = [f for f in on_disk if f not in SKIP_FILES]
        total = sum(info[f]["lines"] for f in js)
        big = max(js, key=lambda f: info[f]["lines"])
        dup_names = [e for e in errors if "の両方で定義" in e or "2回定義" in e]
        print(f"JSファイル数: {len(js)}（自動生成を除く） / 合計行数: {total} / 最大: {big} {info[big]['lines']}行")
        for f in js: print(f"  {info[f]['lines']:4d}行  {f}  （最上位の名前 {len(info[f]['names'])}個）")
        print(f"複数ファイルで定義された名前: {len(dup_names)}")
        print(f"CSS: ファイル {len(css_files)} / 未使用class {len(unused_classes)} / 重複した選択子 {len(dups)} / 未定義の変数 {len(used_vars - defined)} / 未使用の変数 {len(defined - used_vars - dynamic)}")
        print(f"使われていないJSの名前: {len([w for w in warns if 'どこからも使われていません' in w])}")
        print(f"紛れやすいため使用判定から外した短い名前: {sorted(ambiguous)}")
    for w in warns: print("注意:", w)
    for e in errors: print("エラー:", e)
    print(f"\n構造の検査: エラー {len(errors)} 件、注意 {len(warns)} 件")
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
