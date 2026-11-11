"use strict";
// ===== 保存（この端末の中）と集計 =====
const KEY = "tameru-calendar-v1";   // アプリ名を変えても、この名前は変えない（保存済みの記録を引き続き読むため）
let state, storageOk = true, byDate = {}, invByDate = {};

function sampleState() {
  const today = todayStr(), t = parseKey(today);
  const startD = new Date(t.getFullYear(), t.getMonth() - 1, 1);          // 先月の1日から（先月分の記録も見せるため）
  const start = dkey(startD);
  const tpl = [
    ["スーパー", "cash", "", [["牛乳", 238], ["食パン", 168], ["卵 10個", 278], ["鶏むね肉", 412]]],
    ["コンビニ", "code", "", [["おにぎり", 160], ["お茶", 151]]],
    ["ドラッグストア", "credit", "楽天カード", [["洗剤", 398], ["ティッシュ 5箱", 328], ["歯みがき粉", 258]]],
    ["カフェ", "code", "", [["カフェラテ", 480]]],
    ["書店", "credit", "三井住友カード", [["文庫本", 880]]],
    ["スーパー", "cash", "", [["豚こま肉", 356], ["キャベツ", 198], ["豆腐", 88], ["納豆", 108], ["バナナ", 158]]],
  ];
  const entries = [];
  let i = 0;
  for (let k = start; k < today; k = addDays(k, 1), i++) {
    if (i % 5 === 1 || i % 7 === 3) continue;                 // 使わなかった日
    const p = tpl[i % tpl.length];
    entries.push({ id: "s" + i, date: k, store: p[0], pay: p[1], card: p[2], items: p[3].map((x) => ({ n: x[0], p: x[1] })), total: p[3].reduce((a, x) => a + x[1], 0) });
  }
  return { v: 1, daily: 500, start, cards: [makeCard("楽天カード"), Object.assign(makeCard("三井住友カード"), { close: 15, pay: 10 })], entries, invests: [{ id: "si1", date: dkey(new Date(t.getFullYear(), t.getMonth() - 1, 25)), amount: 5000, memo: "つみたて（見本）" }], mail: normMail(), sample: true };
}
// 読み込んだ中身を点検して、壊れた記録があっても画面が止まらないようにする
function normInvests(list) {
  return (Array.isArray(list) ? list : []).map((v, n) => {
    const a = Math.round(Number(v && v.amount));
    return v && isKey(v.date) && Number.isFinite(a) && a > 0 ? { id: String(v.id || "i" + n), date: v.date, amount: Math.min(99999999, a), memo: String(v.memo || "").slice(0, 60) } : null;
  }).filter(Boolean);
}
function normalize(s) {
  const d = Number(s.daily);
  const out = { v: 1, daily: Number.isFinite(d) ? Math.min(1000000, Math.max(0, Math.round(d))) : 500, start: isKey(s.start) ? s.start : todayStr(),
    cards: Array.isArray(s.cards) ? s.cards.map(normCard).filter(Boolean).slice(0, 30) : [], entries: [], invests: normInvests(s.invests), mail: normMail(s.mail), sample: !!s.sample };
  (Array.isArray(s.entries) ? s.entries : []).forEach((e, n) => {
    if (!e || !isKey(e.date) || !Array.isArray(e.items)) return;
    const items = e.items.map((i) => ({ n: String((i && i.n) || ""), p: Math.round(Number(i && i.p)) || 0 }));
    out.entries.push({ id: String(e.id || "e" + n), date: e.date, store: String(e.store || ""), pay: ["cash", "code", "credit"].includes(e.pay) ? e.pay : "cash",
      card: String(e.card || ""), items, total: items.reduce((a, i) => a + i.p, 0), src: e.src === "mail" ? "mail" : "", rc: e.rc === true });
  });
  return out;
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { storageOk = false; }
  if (raw) { try { const s = JSON.parse(raw); if (s && typeof s === "object") return normalize(s); } catch (e) {} }
  else if (storageOk) { try { localStorage.setItem(KEY + "-t", "1"); localStorage.removeItem(KEY + "-t"); } catch (e) { storageOk = false; } }   // 初回だけ、保存できる環境かを確かめる
  return sampleState();
}
// 書くだけ（画面は描き直さない）。記録が変わっていない更新に使う
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch (e) { storageOk = false; } }
function save() { persist(); reindex(); renderAll(); }
function reindex() { byDate = {}; invByDate = {}; state.invests.forEach((v) => { invByDate[v.date] = (invByDate[v.date] || 0) + v.amount; }); state.entries.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
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
// 見本を使っている間に最初の記録を保存したら、見本は消して本物の記録だけにする
function leaveSample(keep) {
  if (!state.sample) return;
  state.entries = []; state.invests = []; state.cards = state.cards.filter((c) => keep.includes(c.name)); state.start = todayStr(); state.sample = false;
}
function freshState(keepCards) { return { v: 1, daily: state.daily, start: todayStr(), cards: keepCards ? state.cards : [], entries: [], invests: [], mail: state.mail, sample: false }; }
