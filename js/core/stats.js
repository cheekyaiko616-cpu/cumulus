"use strict";
// ===== 索引と集計 =====
// 役割: 日付ごとの索引（byDate）を作り、使った金額・使わなかった日・投資資金・支払い方法ごと／お店ごとの内訳（お店は表記ゆれをまとめる）を数える。お店の名寄せは、チェーン名の辞書（receipt-parse.js・receipt-dict.js）を呼ぶときに読む
// 依存: util.js, model.js, billing.js
// 実行時: receipt-dict.js, receipt-parse.js
// 公開: byDate, reindex, spentOn, isSavedDay, rangeStats, monthStats, payBreakdown, payEntries, groupByMonth, shopBreakdown, shopEntries

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
// 月ごとの組（年・期間指定の月の帯用）。list の並びのまま、月が替わるたびに組を分ける。sum・n は組の合計と件数（組の合計の合計 = list の合計）
function groupByMonth(list) {
  const out = []; let cur = null;
  list.forEach((e) => {
    const ym = e.date.slice(0, 7);
    if (!cur || cur.ym !== ym) { cur = { ym, y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)), sum: 0, n: 0, rows: [] }; out.push(cur); }
    cur.sum += e.total; cur.n++; cur.rows.push(e);
  });
  return out;
}

// ---- お店ごとの内訳 ----
// 名寄せ：全角半角・大文字小文字・空白・「・」「-」の違いをそろえ、辞書（receipt-parse.js の RC_CHAINS・receipt-dict.js の RC_BRAND_TEXT）にあるチェーンは
// 「チェーン名」「チェーン名＋支店名（◯◯店）」を1つにまとめる。辞書にない店は、そろえた名前が完全に同じときだけまとめる（似た名前は結合しない）
const SHOP_NONE = "店名なし";
const shopNorm = (s) => String(s).normalize("NFKC").toLowerCase().replace(/[\s・･·\-‐−–—]/g, "");
let shopChainTab = null;
function shopChains() {
  if (shopChainTab) return shopChainTab;
  const t = [];
  if (typeof RC_CHAINS !== "undefined") RC_CHAINS.forEach(([name, alias]) => alias.concat([name]).forEach((a) => t.push({ k: shopNorm(a), name })));
  if (typeof RC_BRAND_TEXT !== "undefined") RC_BRAND_TEXT.split(" ").forEach((w) => t.push({ k: shopNorm(w), name: w }));
  return (shopChainTab = t.filter((c) => c.k.length >= 2).sort((a, b) => b.k.length - a.k.length));
}
// 支店名の部分（◯◯店）か：市区町村の名前そのもの、または名前との間に空白があり6字以内
const shopBranch = (rest, spaced) => {
  if (rest === "" || rest === "店") return true;
  const m = rest.match(/^(.+?)(?:支店|店)$/); if (!m) return false;
  return (typeof RC_CITIES !== "undefined" && RC_CITIES.has(m[1])) || (spaced && m[1].length <= 6);
};
function shopKey(raw) {
  const t = String(raw || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return { key: "", name: SHOP_NONE };
  const n = shopNorm(t);
  for (const c of shopChains()) if (n.startsWith(c.k) && shopBranch(n.slice(c.k.length), /\s/.test(t.slice(0, 40)))) return { key: "c:" + c.name, name: c.name };
  return { key: "s:" + n, name: t };
}
// 期間・区分（key：payKey の値。空なら全体）のお店ごとの内訳。rows は金額の多い順の上位 top 店、other は残り（1店だけなら rows に入れる）。合計は rangeStats の spent と一致する
function shopBreakdown(from, to, key, top) {
  const memo = new Map(), g = new Map(), out = { rows: [], other: null, total: 0, count: 0, shops: 0 };
  for (const k in byDate) if (k >= from && k <= to) byDate[k].forEach((e) => {
    if (key && payKey(e) !== key) return;
    let s = memo.get(e.store); if (!s) { s = shopKey(e.store); memo.set(e.store, s); }
    let r = g.get(s.key); if (!r) { r = { key: s.key, name: s.name, sum: 0, n: 0, forms: new Map() }; g.set(s.key, r); }
    r.sum += e.total; r.n++; out.total += e.total; out.count++;
    if (s.key[0] === "s") r.forms.set(s.name, (r.forms.get(s.name) || 0) + e.total);
  });
  const all = [...g.values()].sort((a, b) => b.sum - a.sum || (a.key < b.key ? -1 : 1));
  all.forEach((r) => { let best = -1; r.forms.forEach((v, nm) => { if (v > best) { best = v; r.name = nm; } }); });   // 表記が複数あれば、金額の大きい書き方
  const N = top || 8, rest = all.slice(N);
  out.rows = all.slice(0, N); out.shops = all.length;
  if (rest.length === 1) out.rows.push(rest[0]);
  else if (rest.length) out.other = { sum: rest.reduce((a, r) => a + r.sum, 0), n: rest.reduce((a, r) => a + r.n, 0), shops: rest.length };
  return out;
}
// 1店の明細（新しい日から）
function shopEntries(from, to, key, shop) {
  const memo = new Map();
  return state.entries.filter((e) => {
    if (e.date < from || e.date > to || (key && payKey(e) !== key)) return false;
    let s = memo.get(e.store); if (!s) { s = shopKey(e.store); memo.set(e.store, s); }
    return s.key === shop;
  }).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
}
