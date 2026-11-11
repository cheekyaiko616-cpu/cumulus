"use strict";
// ===== メールからの自動取り込み =====
// あなたのGoogleアカウント内の小さなプログラム（tools/apps-script/Code.gs）が、三井住友カードの
// 「ご利用のお知らせ」メールだけを読み、日付・時刻・金額・利用先だけをこのアプリに返す。
// JCBは、メールの書式の見本が届いてから対応する（Code.gs の ISSUERS に足すだけで増やせる）
const MAIL_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^\/]+\/|macros\/)s\/[\w-]+\/exec$/;
const MAIL_ISSUERS = { smbc: { name: "三井住友カード", hint: "三井住友" } };
const MAIL_EVERY = 30 * 60 * 1000;                                // 自動で調べる間隔の下限（30分）
const MAIL_RETRY = 10 * 60 * 1000;                                // 失敗したあと、自動で試し直すまでの下限（10分）
let mailBlocked = false, mailTryAt = 0;                          // mailBlocked：URLや合言葉の誤りで失敗したあとは、直るまで自動では試さない

function normMail(m) {
  m = m && typeof m === "object" ? m : {};
  return {
    url: typeof m.url === "string" ? m.url.trim().slice(0, 300) : "",
    token: typeof m.token === "string" ? m.token.slice(0, 80) : "",
    auto: m.auto !== false,                                       // 標準は「自動で記録する」
    cards: { smbc: m.cards && typeof m.cards.smbc === "string" ? m.cards.smbc : "" },
    last: Number.isFinite(m.last) ? m.last : 0,
    lastNote: typeof m.lastNote === "string" ? m.lastNote.slice(0, 160) : "",
    seen: (Array.isArray(m.seen) ? m.seen : []).filter((x) => typeof x === "string").slice(-1500),   // 取り込み済みの目印（消した記録を再取り込みしないため）
  };
}
const makeToken = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, "0")).join(""); };
const mailReady = () => MAIL_URL_RE.test(state.mail.url) && !!state.mail.token;

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

// ---- 取得 ----
// 何日前までのメールを見るか：前回から日が空いていても取りこぼさないよう、前回からの日数に余裕を足す
const mailDays = () => state.mail.last ? Math.min(120, Math.max(14, Math.ceil((Date.now() - state.mail.last) / 86400000) + 14)) : 45;
async function fetchMail() {
  const m = state.mail;
  if (!mailReady()) throw new Error("setup");
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(m.url + "?token=" + encodeURIComponent(m.token) + "&days=" + mailDays(), { signal: ctl.signal, credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("http");
    const j = await res.json();
    if (!j || typeof j !== "object") throw new Error("format");
    if (j.ok !== true) throw new Error(j.error === "token" ? "token" : "format");
    if (!Array.isArray(j.items)) throw new Error("format");
    return j;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally { clearTimeout(timer); }
}
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
  state.mail.seen = state.mail.seen.slice(-1500);
  return plan.add.length;
}

// ---- 実行 ----
let mailBusy = false, mailPending = 0, mailItems = [];
const planNote = (p, u) => "追加" + p.add.length + "件・重複" + p.dup.length + "件・取込済み" + p.done.length + "件" + (p.other.length ? "・要確認" + p.other.length + "件" : "") + (u ? "・読めなかったメール" + u + "通" : "");
const mailErrText = (e) => ({
  setup: "まだ連携の準備ができていません。「連携の準備をする」から進めてください。",
  token: "合言葉が合いません。「連携の準備をする」でスクリプトをコピーし直し、貼り付け直してください。",
  timeout: "時間がかかったので止めました。もう一度試してください。",
  format: "想定と違う返事でした。URLが「…/exec」で終わっているか確認してください。",
  http: "取得できませんでした。URLが正しいか、デプロイの「アクセスできるユーザー」が「全員」か確認してください。",
}[e && e.message] || "接続できませんでした。通信状況とURLを確認してください。（このプレビュー画面からは接続できません。公開したアプリで使えます）");
function mailMsg(t) { $("mailMsg").textContent = t || ""; }

async function runMail(manual) {
  if (mailBusy) return;
  if (!mailReady()) { if (manual) mailMsg(mailErrText(new Error("setup"))); return; }
  mailBusy = true; mailTryAt = Date.now(); $("mailRun").disabled = true; if (manual) mailMsg("メールを確認しています…");
  try {
    const j = await fetchMail();
    mailItems = j.items.filter(validItem);
    const plan = planImport(mailItems), u = Number(j.unreadable) || 0;
    state.mail.last = Date.now(); mailBlocked = false;
    if (state.mail.auto) {
      const n = applyImport(plan);
      state.mail.lastNote = planNote(plan, u); mailPending = 0;
      if (n) save(); else { persist(); renderMail(); }                  // 記録が増えなかったときは、書くだけ（画面は描き直さない）
      if (n) toast("メールから" + n + "件を記録しました");
      mailMsg(planNote(plan, u));
    } else {
      state.mail.lastNote = planNote(plan, u); mailPending = plan.add.length;
      persist(); renderMail();
      if (manual) { showPreview(plan, u); mailMsg(""); }
      else if (plan.add.length) toast("新しい利用明細が" + plan.add.length + "件あります。設定で確認できます");
    }
  } catch (e) {
    state.mail.lastNote = "前回は取得できませんでした";
    if (e && ["setup", "token", "format", "http"].includes(e.message)) mailBlocked = true;   // 設定の誤りは、直すまで自動では繰り返さない
    if (manual) mailMsg(mailErrText(e));
    persist(); renderMail();
  } finally { mailBusy = false; $("mailRun").disabled = false; }
}
function autoMail() {
  if (!mailReady() || mailBlocked || document.hidden) return;
  if (navigator.onLine === false || (navigator.connection && navigator.connection.saveData)) return;     // 通信できないとき・データ節約中は、通信しない
  const now = Date.now();
  if (now - state.mail.last < MAIL_EVERY || now - mailTryAt < MAIL_RETRY) return;
  runMail(false);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) autoMail(); });

// ---- 「確認してから記録」の画面 ----
const pvRow = (it) => '<div class="deb"><span>' + mdLabel(it.date) + " " + esc(safeStore(it.store) || "ご利用") + (it.cancel ? "（取消）" : it.kind && it.kind !== "買物" ? "（" + esc(it.kind) + "）" : "") + '</span><b class="num">' + yen(it.amount) + "</b></div>";
function showPreview(plan, u) {
  const sec = (title, list) => list.length ? '<div class="subhead">' + title + "（" + list.length + "件）</div>" + list.map(pvRow).join("") : "";
  $("mailPrevBody").innerHTML = (plan.add.length ? "" : '<div class="empty">新しく記録するものはありません</div>') +
    sec("記録する", plan.add) + sec("重複のため記録しない", plan.dup) + sec("要確認（取消・買物以外のため自動では記録しません）", plan.other) +
    '<p class="hint">' + planNote(plan, u) + "</p>";
  $("mpOk").hidden = !plan.add.length; $("mpOk").textContent = plan.add.length + "件を記録する";
  openOv("mailPrevOverlay");
}
$("mpOk").onclick = () => {
  const plan = planImport(mailItems), n = applyImport(plan);       // 確認している間に状態が変わっても大丈夫なように、改めて判定する
  mailPending = 0; closeOv("mailPrevOverlay"); save(); toast(n ? n + "件を記録しました" : "記録するものはありませんでした");
};

// ---- 設定画面 ----
function renderMail() {
  const m = state.mail, ready = mailReady();
  $("mailSummary").textContent = !ready ? "未設定" : mailPending ? "新着" + mailPending + "件" : m.auto ? "自動で記録" : "確認して記録";
  $("mailState").textContent = ready ? "連携できています。" + (m.auto ? "アプリを開くと、新しい利用明細を自動で記録します。" : "アプリを開くと新着を調べ、確認してから記録します。") : "まだ連携していません。下の「連携の準備をする」から始めてください。";
  if (document.activeElement !== $("mailUrl")) $("mailUrl").value = m.url;
  $("mailSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.a === "1") === m.auto));
  const names = state.cards.map((c) => c.name);
  $("mCardSmbc").innerHTML = '<option value="">自動（名前に「三井住友」を含むカード）</option>' + names.map((n) => "<option" + (n === m.cards.smbc ? " selected" : "") + ">" + esc(n) + "</option>").join("");
  if (!names.includes(m.cards.smbc)) $("mCardSmbc").value = "";
  $("mailLast").textContent = m.last ? "前回：" + new Date(m.last).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (m.lastNote ? "（" + m.lastNote + "）" : "") : "";
  syncPickers();
}
$("openMail").onclick = () => { renderMail(); mailMsg(""); openOv("mailOverlay"); };
$("mailRun").onclick = () => runMail(true);
$("mailSeg").onclick = (e) => { const b = e.target.closest("[data-a]"); if (b) { state.mail.auto = b.dataset.a === "1"; save(); } };
$("mCardSmbc").onchange = () => { state.mail.cards.smbc = $("mCardSmbc").value; save(); };
$("mailUrl").onchange = () => {
  const v = $("mailUrl").value.trim();
  if (v && !MAIL_URL_RE.test(v)) { mailMsg("URLは「https://script.google.com/…/exec」の形です。コピーし直してください。"); $("mailUrl").value = state.mail.url; return; }
  state.mail.url = v; state.mail.last = 0; mailBlocked = false; save(); mailMsg(v ? "URLを保存しました。「今すぐ取り込む」で試せます。" : "");
};

// ---- 連携の準備（初回だけ） ----
$("mailGuideBtn").onclick = () => openOv("mailGuideOverlay");
$("gasCopy").onclick = async () => {
  if (!state.mail.token) { state.mail.token = makeToken(); save(); }
  const text = GAS_SOURCE.replace('"__TOKEN__"', () => JSON.stringify(state.mail.token));   // 最初の1か所（合言葉の行）だけ入れ替える
  const ta = $("gasText"); ta.value = text;
  try { await navigator.clipboard.writeText(text); toast("スクリプトをコピーしました"); ta.hidden = true; }
  catch (e) { ta.hidden = false; ta.focus(); ta.select(); toast("下の文字を全部選んでコピーしてください"); }
};
$("tokenNew").onclick = () => {
  if (!armed($("tokenNew"), "もう一度押すと作り直します")) return;
  state.mail.token = makeToken(); state.mail.last = 0; mailBlocked = false; save(); toast("合言葉を作り直しました。スクリプトも貼り直してください");
};
