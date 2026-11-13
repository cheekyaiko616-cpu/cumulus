"use strict";
// ===== データの定義 =====
// 役割: 保存するデータの形・上限・初期値・読み込み時の点検（normalize）を、ここに集める。データの形を変えるときは、ここだけを直す
// 依存: util.js
// 実行時: なし
// 公開: state, STATE_VERSION, MAX_PRICE, MAX_INV, MIN_DATE, MAX_DAILY, MAX_CARDS, MAX_SEEN, MAX_MEMO, DEFAULT_DAILY, PAY, payLabel, makeCard, normMail, normalize, freshState

let state;                                  // 現在のデータ（唯一の正）。形は normalize() が決める

// ---- 上限・既定値 ----
const STATE_VERSION = 1;                    // 保存データの版。形を変えるときは上げて、migrate() で古い形を直す
const MAX_PRICE = 9999999;                  // 品目1つの金額の上限
const MAX_INV = 99999999;                   // 投資1件の金額の上限
const MIN_DATE = "2000-01-01";              // 入力できる一番古い日
const MAX_DAILY = 1000000;                  // 「1日あたりの投資資金」の上限
const MAX_CARDS = 30;                       // 登録できるカードの数
const MAX_SEEN = 1500;                      // 取り込み済みの目印を覚えておく数
const MAX_MEMO = 60;                        // 投資のメモの長さ
const MAX_URL = 300, MAX_TOKEN = 80, MAX_NOTE = 160;
const DEFAULT_DAILY = 500;
const DEFAULT_CARD = { close: 0, pay: 27, months: 1 };   // 設定していないカードは「月末締め・翌月27日払い」として計算する

// ---- 支払い方法の表示名 ----
const PAY = { cash: "現金", code: "バーコード決済", credit: "クレジット" };
const payLabel = (e) => e.pay === "credit" ? (e.card || "クレジット") : PAY[e.pay];

// ---- 各データの作り方・点検 ----
// カード：close=締め日（0は月末）、months=引き落とし月（1=翌月、2=翌々月）、pay=引き落とし日（0は月末）
const makeCard = (name) => Object.assign({ name }, DEFAULT_CARD);
function normCard(c) {
  if (typeof c === "string") return c ? makeCard(c) : null;      // 古い保存データ（名前だけ）にも対応
  if (!c || typeof c.name !== "string" || !c.name) return null;
  const num = (v, lo, hi, d) => Number.isInteger(v) && v >= lo && v <= hi ? v : d;
  return { name: c.name, close: num(c.close, 0, 28, 0), pay: num(c.pay, 0, 28, 27), months: num(c.months, 1, 2, 1) };
}
function normInvests(list) {
  return (Array.isArray(list) ? list : []).map((v, n) => {
    const a = Math.round(Number(v && v.amount));
    return v && isKey(v.date) && Number.isFinite(a) && a > 0 ? { id: String(v.id || "i" + n), date: v.date, amount: Math.min(MAX_INV, a), memo: String(v.memo || "").slice(0, MAX_MEMO) } : null;
  }).filter(Boolean);
}
// メール連携の設定：url=連携のURL、token=合言葉、auto=自動で記録するか、cards=発行元ごとの記録先カード、last=前回の確認（時刻）、seen=取り込み済みの目印
function normMail(m) {
  m = m && typeof m === "object" ? m : {};
  return {
    url: typeof m.url === "string" ? m.url.trim().slice(0, MAX_URL) : "",
    token: typeof m.token === "string" ? m.token.slice(0, MAX_TOKEN) : "",
    auto: m.auto !== false,                                       // 標準は「自動で記録する」
    cards: { smbc: m.cards && typeof m.cards.smbc === "string" ? m.cards.smbc : "", jcb: m.cards && typeof m.cards.jcb === "string" ? m.cards.jcb : "" },
    last: Number.isFinite(m.last) ? m.last : 0,
    lastNote: typeof m.lastNote === "string" ? m.lastNote.slice(0, MAX_NOTE) : "",
    seen: (Array.isArray(m.seen) ? m.seen : []).filter((x) => typeof x === "string").slice(-MAX_SEEN),   // 取り込み済みの目印（消した記録を再取り込みしないため）
  };
}
// 将来、保存データの形を変えるときは、STATE_VERSION を上げて、ここで古い形を新しい形に直す（今は何もしない）
function migrate(s) { return s; }

// 読み込んだ中身を点検して、壊れた記録があっても画面が止まらないようにする
// 記録：id, date, store, pay(cash|code|credit), card, items[{n,p}], total, src("mail"|""), rc(レシートと結び付いたメールの記録か)
function normalize(s) {
  s = migrate(s);
  const d = Number(s.daily);
  const out = { v: STATE_VERSION, daily: Number.isFinite(d) ? Math.min(MAX_DAILY, Math.max(0, Math.round(d))) : DEFAULT_DAILY, start: isKey(s.start) ? s.start : todayStr(),
    cards: Array.isArray(s.cards) ? s.cards.map(normCard).filter(Boolean).slice(0, MAX_CARDS) : [], entries: [], invests: normInvests(s.invests), mail: normMail(s.mail), sample: !!s.sample };
  (Array.isArray(s.entries) ? s.entries : []).forEach((e, n) => {
    if (!e || !isKey(e.date) || !Array.isArray(e.items)) return;
    const items = e.items.map((i) => ({ n: String((i && i.n) || ""), p: Math.round(Number(i && i.p)) || 0 }));
    out.entries.push({ id: String(e.id || "e" + n), date: e.date, store: String(e.store || ""), pay: Object.keys(PAY).includes(e.pay) ? e.pay : "cash",
      card: String(e.card || ""), items, total: items.reduce((a, i) => a + i.p, 0), src: e.src === "mail" ? "mail" : "", rc: e.rc === true });
  });
  return out;
}
// 「すべて消す」「見本を消す」のあとの、まっさらな状態（日々の金額とメール連携の設定は引き継ぐ）
function freshState(keepCards) { return { v: STATE_VERSION, daily: state.daily, start: todayStr(), cards: keepCards ? state.cards : [], entries: [], invests: [], mail: state.mail, sample: false }; }
