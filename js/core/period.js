"use strict";
// ===== 期間の決め方 =====
// 役割: 「週・月・年・期間指定」の範囲の計算（まとめと投資の画面で共通）
// 依存: util.js, model.js
// 実行時: なし
// 公開: monthRange, presetRange, unitRange, shiftAnchor, adjustRange

const monthRange = (k) => { const d = parseKey(k); return [ymd(d.getFullYear(), d.getMonth(), 1), lastKey(d.getFullYear(), d.getMonth())]; };
// 期間指定の早押しボタンの範囲。startKey は「数え始める日」（"all" のときだけ使う）
function presetRange(name, startKey) {
  const t = todayStr(), d = parseKey(t), y = d.getFullYear(), m = d.getMonth();
  if (name === "last") { const p = new Date(y, m - 1, 1); return [ymd(p.getFullYear(), p.getMonth(), 1), lastKey(p.getFullYear(), p.getMonth())]; }
  if (name === "d30") return [addDays(t, -29), t];
  if (name === "year") return [ymd(y, 0, 1), ymd(y, 11, 31)];
  if (name === "all") return [startKey || t, t];
  return [ymd(y, m, 1), lastKey(y, m)];                          // 今月
}
// anchor（基準の日）を含む、週・月・年の範囲と、その名前
function unitRange(unit, anchor) {
  const d = parseKey(anchor), y = d.getFullYear(), m = d.getMonth();
  if (unit === "week") { const from = addDays(anchor, -d.getDay()), to = addDays(from, 6); return { from, to, label: mdLabel(from) + " 〜 " + mdLabel(to) }; }
  if (unit === "year") return { from: ymd(y, 0, 1), to: ymd(y, 11, 31), label: y + "年" };
  return { from: ymd(y, m, 1), to: lastKey(y, m), label: y + "年" + (m + 1) + "月" };
}
// 基準の日を、前後の週・月・年へ動かす
function shiftAnchor(unit, anchor, delta) {
  const d = parseKey(anchor);
  if (unit === "week") d.setDate(d.getDate() + 7 * delta); else if (unit === "year") d.setFullYear(d.getFullYear() + delta, d.getMonth(), 1); else d.setMonth(d.getMonth() + delta, 1);
  return dkey(d);
}
// 開始日・終了日の入力を整える。which は "from" か "to"。2000-01-01より前は丸め、逆転したらもう一方を合わせる。日付でなければ null
function adjustRange(which, v, from, to) {
  if (!isKey(v)) return null;
  if (v < MIN_DATE) v = MIN_DATE;
  if (which === "from") { from = v; if (to < from) to = from; } else { to = v; if (from > to) from = to; }
  return [from, to];
}
