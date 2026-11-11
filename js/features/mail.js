"use strict";
// ===== メールからの自動取り込み（通信と画面） =====
// 役割: 連携のURLへ問い合わせて明細を取り、規則（core/mail-plan.js）で振り分けて記録する。アプリを開いたとき・戻ったときに、必要なときだけ調べる。設定画面・連携の準備・確認画面
// 依存: util.js, model.js, mail-plan.js, gas-source.js, storage.js, dom.js, overlay.js, picker.js, rows.js
// 実行時: なし
// 公開: mailBlocked, mailTryAt, fetchMail, runMail, autoMail, renderMail

const MAIL_EVERY = 30 * 60 * 1000;                                // 自動で調べる間隔の下限（30分）
const MAIL_RETRY = 10 * 60 * 1000;                                // 失敗したあと、自動で試し直すまでの下限（10分）
let mailBlocked = false, mailTryAt = 0;                          // mailBlocked：URLや合言葉の誤りで失敗したあとは、直るまで自動では試さない
let mailBusy = false, mailPending = 0, mailItems = [];

// ---- 取得（通信） ----
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
const mailErrText = (e) => ({
  setup: "まだ連携の準備ができていません。「連携の準備をする」から進めてください。",
  token: "合言葉が合いません。「連携の準備をする」でスクリプトをコピーし直し、貼り付け直してください。",
  timeout: "時間がかかったので止めました。もう一度試してください。",
  format: "想定と違う返事でした。URLが「…/exec」で終わっているか確認してください。",
  http: "取得できませんでした。URLが正しいか、デプロイの「アクセスできるユーザー」が「全員」か確認してください。",
}[e && e.message] || "接続できませんでした。通信状況とURLを確認してください。（このプレビュー画面からは接続できません。公開したアプリで使えます）");
function mailMsg(t) { $("mailMsg").textContent = t || ""; }

// ---- 実行 ----
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
const pvRow = (it) => debRow(mdLabel(it.date) + " " + esc(safeStore(it.store) || "ご利用") + (it.cancel ? "（取消）" : it.kind && it.kind !== "買物" ? "（" + esc(it.kind) + "）" : ""), it.amount);
function showPreview(plan, u) {
  const sec = (title, list) => list.length ? '<div class="subhead">' + title + "（" + list.length + "件）</div>" + list.map(pvRow).join("") : "";
  $("mailPrevBody").innerHTML = (plan.add.length ? "" : emptyHtml("新しく記録するものはありません")) +
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
const mailPickId = (k) => "mCard" + k[0].toUpperCase() + k.slice(1);
function renderMail() {
  const m = state.mail, ready = mailReady();
  $("mailSummary").textContent = !ready ? "未設定" : mailPending ? "新着" + mailPending + "件" : m.auto ? "自動で記録" : "確認して記録";
  $("mailState").textContent = ready ? "連携できています。" + (m.auto ? "アプリを開くと、新しい利用明細を自動で記録します。" : "アプリを開くと新着を調べ、確認してから記録します。") : "まだ連携していません。下の「連携の準備をする」から始めてください。";
  if (document.activeElement !== $("mailUrl")) $("mailUrl").value = m.url;
  setSeg($("mailSeg"), (b) => (b.dataset.a === "1") === m.auto);
  const names = state.cards.map((c) => c.name);
  Object.keys(MAIL_ISSUERS).forEach((k) => {                       // 発行元ごとの記録先カードの選択欄（id は mCard + 先頭大文字：mCardSmbc, mCardJcb）
    const sel = $(mailPickId(k));
    sel.innerHTML = '<option value="">自動（名前に「' + MAIL_ISSUERS[k].hint + '」を含むカード）</option>' + names.map((n) => "<option" + (n === m.cards[k] ? " selected" : "") + ">" + esc(n) + "</option>").join("");
    if (!names.includes(m.cards[k])) sel.value = "";
  });
  $("mailLast").textContent = m.last ? "前回：" + new Date(m.last).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (m.lastNote ? "（" + m.lastNote + "）" : "") : "";
  syncPickers();
}
$("openMail").onclick = () => { renderMail(); mailMsg(""); openOv("mailOverlay"); };
$("mailRun").onclick = () => runMail(true);
$("mailSeg").onclick = (e) => { const b = e.target.closest("[data-a]"); if (b) { state.mail.auto = b.dataset.a === "1"; save(); } };
Object.keys(MAIL_ISSUERS).forEach((k) => { $(mailPickId(k)).onchange = () => { state.mail.cards[k] = $(mailPickId(k)).value; save(); }; });
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
