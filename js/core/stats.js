"use strict";
// ===== 索引と集計 =====
// 役割: 日付ごとの索引（byDate）を作り、使った金額・使わなかった日・投資資金・支払い方法ごとの内訳を数える
// 依存: util.js, model.js, billing.js
// 実行時: なし
// 公開: byDate, reindex, spentOn, isSavedDay, rangeStats, monthStats, payBreakdown, payEntries

let byDate = {};
// 記録が変わったら呼ぶ：日付ごとの索引と、カードの引き落としを作り直す
function reindex() {
  byDate = {};
  state.entries.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  buildPayments();
}
const spentOn = (k) => (byDate[k] || []).reduce((a, e) => a + e.total, 0);
// 使わなかった日：数え始める日〜昨日で、記録が1件もない日
const isSavedDay = (k) => k >= state.start && k < todayStr() && !byDate[k];
// 期間の集計。使わなかった日は「期間の日数 − 記録のある日数」で数える（1日ずつ回さない）
function rangeStats(from, to) {
  let spent = 0, savedDays = 0;
  for (const k in byDate) if (k >= from && k <= to) { spent += spentOn(k); }
  const yesterday = addDays(todayStr(), -1);
  const a = from > state.start ? from : state.start, b = to < yesterday ? to : yesterday;
  if (a <= b) { savedDays = daysBetween(a, b) + 1; for (const k in byDate) if (k >= a && k <= b) savedDays--; }
  // 実際に投資した金額（投資の記録）
  let invested = 0;
  state.invests.forEach((v) => { if (v.date >= from && v.date <= to) { invested += v.amount; } });
  const invest = savedDays * state.daily;
  return { spent, savedDays, invest, invested, left: invest - invested };
}
const monthStats = (y, m) => rangeStats(ymd(y, m, 1), lastKey(y, m));

// ---- 支払い方法ごとの内訳 ----
// 内訳の区分。現金・バーコード決済、クレジットはカードごと（カード未選択も1つ）。カードの名前は引き落とし（billing.js）と同じ数え方
const payKey = (e) => e.pay === "credit" ? "credit:" + (e.card || NO_CARD) : e.pay;
// 期間の内訳。rows は金額の多い順で、合計（total）は rangeStats の spent と必ず一致する
function payBreakdown(from, to) {
  const rows = {}, out = { rows: [], total: 0, count: 0 };
  for (const k in byDate) if (k >= from && k <= to) byDate[k].forEach((e) => {
    const key = payKey(e), r = rows[key] || (rows[key] = { key, pay: e.pay, name: e.pay === "credit" ? e.card || NO_CARD : PAY[e.pay], sum: 0, n: 0 });
    r.sum += e.total; r.n++; out.total += e.total; out.count++;
  });
  out.rows = Object.values(rows).sort((a, b) => b.sum - a.sum || (a.key < b.key ? -1 : 1));
  return out;
}
// 内訳の1区分の明細（新しい日から）
const payEntries = (from, to, key) => state.entries.filter((e) => e.date >= from && e.date <= to && payKey(e) === key).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
