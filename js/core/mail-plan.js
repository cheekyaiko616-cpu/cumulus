"use strict";
// ===== メール取り込みの規則 =====
// 役割: 利用通知メールの明細を、すでにある記録と照らして「追加・重複・取込済み・要確認」に分け、記録に加える（通信と画面は features/mail.js）
// 依存: util.js, guard.js, model.js, sample.js
// 実行時: なし
// 公開: MAIL_ISSUERS, MAIL_URL_RE, makeToken, mailReady, mailDays, validItem, safeStore, planImport, applyImport, planNote, matchMailEntry

// 発行元の追加：ここに足し、Code.gs の ISSUERS にも同じ id で足す（README「カード会社を足すとき」）
const MAIL_ISSUERS = { smbc: { name: "三井住友カード", hint: "三井住友" }, jcb: { name: "JCBカード", hint: "JCB" } };
const MAIL_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^\/]+\/|macros\/)s\/[\w-]+\/exec$/;   // 合言葉を送ってよい宛先は、これだけ
const makeToken = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, "0")).join(""); };
const mailReady = () => MAIL_URL_RE.test(state.mail.url) && !!state.mail.token;
// 何日前までのメールを見るか：前回から日が空いていても取りこぼさないよう、前回からの日数に余裕を足す
const mailDays = () => state.mail.last ? Math.min(120, Math.max(14, Math.ceil((Date.now() - state.mail.last) / 86400000) + 14)) : 45;

// ---- どのカードの記録にするか ----
function mailCardName(issuer) {
  const want = state.mail.cards[issuer];
  if (want && state.cards.some((c) => c.name === want)) return want;
  const hit = state.cards.find((c) => c.name.indexOf(MAIL_ISSUERS[issuer].hint) >= 0);
  return hit ? hit.name : "";
}
function ensureMailCard(issuer) {
  let name = mailCardName(issuer);
  if (!name) {                                                    // 登録がなければ、名前だけのカードを作る（引き落とし日は設定で直す）
    name = MAIL_ISSUERS[issuer].name;
    if (!state.cards.some((c) => c.name === name)) state.cards.push(makeCard(name));
    state.mail.cards[issuer] = name;
  }
  return name;
}

// ---- 明細の点検 ----
const validItem = (it) => !!it && !!MAIL_ISSUERS[it.issuer] && typeof it.id === "string" && it.id.length < 80 && isKey(it.date) && /^\d{2}:\d{2}$/.test(String(it.time)) &&
  Number.isInteger(it.amount) && it.amount > 0 && it.amount <= MAX_PRICE;
const safeStore = (s) => { s = String(s || "").trim().slice(0, 40); return looksSensitive(s) ? "" : s; };
const seenKeys = (it) => ["m:" + it.id, "c:" + it.issuer + " " + it.date + " " + it.time + " " + it.amount];

// ---- 重複の判定 ----
// すでにある記録（手で入れたもの）と、同じカード・同じ金額・日付が前後1日以内なら「重複」。
// 1件の記録には1通のメールだけが対応する（同じ日に同額を2回使った場合は、件数で数える）
function planImport(items) {
  const seen = new Set(state.mail.seen), used = new Set();
  const plan = { add: [], dup: [], done: [], other: [] };
  items.slice().sort((a, b) => (a.date + a.time + a.id) < (b.date + b.time + b.id) ? -1 : 1).forEach((it) => {
    const keys = seenKeys(it);
    if (keys.some((k) => seen.has(k))) { plan.done.push(it); return; }
    if (it.cancel || (it.kind && it.kind !== "買物")) { plan.other.push(it); return; }   // 取消・買物以外は、自動では記録しない
    const card = mailCardName(it.issuer), hint = MAIL_ISSUERS[it.issuer].hint;
    const hit = state.entries
      .filter((e) => e.pay === "credit" && e.src !== "mail" && !used.has(e) && e.total === it.amount && Math.abs(daysBetween(e.date, it.date)) <= 1 &&
        (e.card === card || !e.card || (!card && e.card.indexOf(hint) >= 0)))
      .sort((a, b) => Math.abs(daysBetween(a.date, it.date)) - Math.abs(daysBetween(b.date, it.date)))[0];
    if (hit) { used.add(hit); plan.dup.push(it); return; }
    plan.add.push(it);
  });
  return plan;
}
function applyImport(plan) {
  if (!plan.add.length) return 0;
  if (state.sample) leaveSample(state.cards.map((c) => c.name));  // 見本のまま取り込むと混ざるので、見本は消す
  plan.add.forEach((it) => {
    const store = safeStore(it.store);
    state.entries.push({ id: "m" + Date.now() + Math.random().toString(36).slice(2, 7), date: it.date, store, pay: "credit", card: ensureMailCard(it.issuer),
      items: [{ n: store || "ご利用", p: it.amount }], total: it.amount, src: "mail" });
    seenKeys(it).forEach((k) => state.mail.seen.push(k));
  });
  state.mail.seen = state.mail.seen.slice(-MAX_SEEN);
  return plan.add.length;
}
const planNote = (p, u) => "追加" + p.add.length + "件・重複" + p.dup.length + "件・取込済み" + p.done.length + "件" + (p.other.length ? "・要確認" + p.other.length + "件" : "") + (u ? "・読めなかったメール" + u + "通" : "");

// ---- レシートとの結び付け ----
// レシートの入力と同じ買い物の、メールの記録を探す：同じカード・同じ合計・日付が前後1日以内で、まだレシートと結び付いていないもの
function matchMailEntry(date, total, card) {
  if (!isKey(date) || total <= 0) return null;
  return state.entries
    .filter((e) => e.src === "mail" && !e.rc && e.pay === "credit" && e.total === total && Math.abs(daysBetween(e.date, date)) <= 1 && (!card || !e.card || e.card === card))
    .sort((a, b) => Math.abs(daysBetween(a.date, date)) - Math.abs(daysBetween(b.date, date)) || (a.date < b.date ? -1 : 1))[0] || null;
}
