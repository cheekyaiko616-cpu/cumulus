"use strict";
// ===== クレジットカードの請求 =====
// 役割: 締め日と引き落とし日から、いつ・いくら引き落とされるかを求める（カード設定の形は model.js）
// 依存: util.js, model.js
// 実行時: なし
// 公開: cardOf, cycleEnd, cycleStart, payDateOf, cardRuleText, pays, paysByDate, buildPayments, paysIn

const cardOf = (name) => state.cards.find((c) => c.name === name) || makeCard(name);
// y年m月（mは0始まり。12以上や負の値は自動で年を繰り上げ・繰り下げ）のd日。d=0は月末
function dayOf(y, m, d) {
  const t = new Date(y, m, 1), yy = t.getFullYear(), mm = t.getMonth(), last = new Date(yy, mm + 1, 0).getDate();
  return ymd(yy, mm, d === 0 ? last : Math.min(d, last));
}
// その利用日が入る請求の「締め日」
function cycleEnd(key, close) {
  const t = parseKey(key), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
  if (close === 0) return dayOf(y, m, 0);
  return d <= close ? dayOf(y, m, close) : dayOf(y, m + 1, close);
}
// その請求の最初の日（前の締め日の翌日）
function cycleStart(endKey, close) { const t = parseKey(endKey); return addDays(dayOf(t.getFullYear(), t.getMonth() - 1, close), 1); }
// 引き落とし日
function payDateOf(endKey, c) { const t = parseKey(endKey); return dayOf(t.getFullYear(), t.getMonth() + c.months, c.pay); }
// 「月末締め・翌月27日払い」のような説明
function cardRuleText(c) {
  const mo = c.months === 1 ? "翌月" : "翌々月";
  return (c.close === 0 ? "月末" : c.close + "日") + "締め・" + (c.pay === 0 ? mo + "末" : mo + c.pay + "日") + "払い";
}

// 全カードの引き落とし（日付順）。reindex() のたびに作り直す
let pays = [], paysByDate = {};
function buildPayments() {
  const groups = {};
  state.entries.forEach((e) => {
    if (e.pay !== "credit") return;
    const name = e.card || "カード未選択", c = cardOf(e.card), end = cycleEnd(e.date, c.close), date = payDateOf(end, c), k = date + "|" + name;
    const g = groups[k] || (groups[k] = { date, card: name, amount: 0, from: cycleStart(end, c.close), to: end });
    g.amount += e.total;
  });
  pays = Object.values(groups).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.card < b.card ? -1 : 1);
  paysByDate = {};
  pays.forEach((p) => { (paysByDate[p.date] = paysByDate[p.date] || []).push(p); });
}
const paysIn = (from, to) => pays.filter((p) => p.date >= from && p.date <= to);
