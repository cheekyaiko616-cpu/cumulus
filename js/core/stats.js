"use strict";
// ===== 索引と集計 =====
// 役割: 日付ごとの索引（byDate）を作り、使った金額・使わなかった日・投資資金を数える
// 依存: util.js, model.js, billing.js
// 実行時: なし
// 公開: byDate, reindex, spentOn, isSavedDay, rangeStats, monthStats

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
  let spent = 0, count = 0, savedDays = 0;
  for (const k in byDate) if (k >= from && k <= to) { spent += spentOn(k); count += byDate[k].length; }
  const yesterday = addDays(todayStr(), -1);
  const a = from > state.start ? from : state.start, b = to < yesterday ? to : yesterday;
  if (a <= b) { savedDays = daysBetween(a, b) + 1; for (const k in byDate) if (k >= a && k <= b) savedDays--; }
  // 実際に投資した金額（投資の記録）
  let invested = 0, investCount = 0;
  state.invests.forEach((v) => { if (v.date >= from && v.date <= to) { invested += v.amount; investCount++; } });
  const invest = savedDays * state.daily;
  return { spent, count, savedDays, invest, invested, investCount, left: invest - invested };
}
const monthStats = (y, m) => rangeStats(ymd(y, m, 1), lastKey(y, m));
