"use strict";
// ===== レシートの文字の解析 =====
// 役割: 読み取った文字から、品目・金額・合計・日付・お店を取り出す（写真を読む部分は features/receipt.js）
// 依存: util.js, guard.js
// 実行時: なし
// 公開: parseReceipt

function parseReceipt(text) {
  const z2h = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[，]/g, ",").replace(/[￥]/g, "¥");
  const lines = z2h(text).split(/\r?\n/).map((l) => l.replace(/[ \t　]+/g, " ").trim()).filter(Boolean);
  const SKIP = /小計|合計|税|預|釣|現計|点数|ポイント|TEL|電話|No\.?|カード|残高|対象|領収|レジ|責|会員|支払|クレジット|現金|お買上|\d{4}[年\/]/i;
  const out = { store: "", date: "", total: 0, items: [] };
  for (const l of lines) {
    const dm = l.match(/(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})/);
    if (dm && !out.date) out.date = dm[1] + "-" + pad(dm[2]) + "-" + pad(dm[3]);
    if (looksSensitive(l)) continue;                          // カード番号・会員番号・電話番号などの行は読み捨てる
    const m = l.replace(/(\d)\s*,\s*(\d{3})/g, "$1,$2").match(/^(.*?)\s*[¥\\]?\s*(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*円?\s*[※*軽内外非]*$/);
    if (!m) { if (!out.store && !/\d{2,}/.test(l)) out.store = l; continue; }
    const name = m[1].replace(/[¥\\*※]+$/g, "").trim(), price = Number(m[2].replace(/,/g, ""));
    if (/合計/.test(name) && !/小計/.test(name)) { out.total = Math.max(out.total, price); continue; }
    if (!name || SKIP.test(name) || price === 0 || Math.abs(price) > 999999) continue;
    if (price < 0 && !/値引|割引|引/.test(name)) continue;
    out.items.push({ n: name, p: price });
  }
  return out;
}
