"use strict";
// ===== 月次レポート（コピーと自動送信） =====
// 役割: 設定の「月次レポート」。先月（または選んだ月）のレポート用データをコピーする、月が替わった最初の起動で先月分をGoogleスプレッドシートへ1回だけ送る（連携のURLへPOST）。通信は、この送信と手動の操作だけ。タイマー・定期取得はない
// 依存: util.js, model.js, mail-plan.js, report-data.js, storage.js, dom.js, overlay.js, picker.js
// 実行時: なし
// 公開: rp, rpBlocked, rpTryAt, rpBusy, rpClear, postReport, sendReport, autoReport, renderReport

const RP_RETRY = 10 * 60 * 1000;                                  // 失敗したあと、自動で試し直すまでの下限（10分）
const RP_MIN_VERSION = 3;                                         // この版未満のスクリプトは新しい配置（曜日・区分・概要）に対応していない。送る前に確かめ、古ければ送らない
const RP_TIMEOUT = 90000, RP_STATUS_TIMEOUT = 15000;              // 1回の送信を待つ上限（90秒）・保存の確認を待つ上限（15秒）
let rp = normReport(readKey(KEY_RP));                             // 設定（別のキーに保存。記録のデータの形は変えない）
let rpBlocked = false, rpTryAt = 0, rpBusy = false;               // rpBlocked：URL・合言葉・スクリプトの誤りで失敗したあとは、直るまで自動では試さない
let rpHold = false, rpChecking = false, rpCtl = null, rpWhy = "";                     // rpHold：時間切れ・中止のあとは、このセッションでは自動で送り直さない（手動は可）。rpCtl：送信中の中止用。rpWhy：中止の理由
let rpCache = null;
const rpPersist = () => { tryWrite(KEY_RP, JSON.stringify(rp)); };
function rpClear() { rp = normReport(null); dropKey(KEY_RP); rpCache = null; rpMsg(""); renderReport(); }
const rpMsg = (t) => { $("rpMsg").textContent = t || ""; };
const RP_ON_TEXT = "毎月、先月の取引の全件（日付・曜日・店名・金額・支払い・カード名・登録方法・区分・品目・月の集計・投資の日付と金額）を、あなたのGoogleスプレッドシートに送ります。支店名・メモ・写真・URL・合言葉・長い数字は送りません。品名に書いた内容はそのまま含まれます。";

// ---- 送信（通信） ----
// 送り先は、メール連携と同じURL（https://script.google.com/…/exec）だけ。本文はテキストのまま（text/plain。事前確認の通信が要らない）。合言葉は本文に入れ、URLには付けない。同じ月は上書きされるので、送り直しても重複しない
// 大きい月は数回に分け、1回ずつ順に送る（最初の分で全消去、続きは決まった行へ書く）。画面を閉じたら通信も止まる（AbortController）
const rpSid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
async function rpFetch(url, opt, ms) {
  const timer = setTimeout(() => { rpWhy = rpWhy || "timeout"; rpCtl.abort(); }, ms);
  try { return await fetch(url, Object.assign({ signal: rpCtl.signal, credentials: "omit", cache: "no-store", redirect: "follow" }, opt)); }
  catch (e) { if (rpCtl.signal.aborted) throw new Error(rpWhy === "cancel" ? "cancel" : "timeout"); throw e; }
  finally { clearTimeout(timer); }
}
async function postReport(d, sid, onPart) {
  const m = state.mail;
  if (!mailReady()) throw new Error("setup");
  const plan = reportPlan(d);
  let unc = false, rows = 0;
  rpCtl = new AbortController(); rpWhy = "";
  for (let i = 0; i < plan.length; i++) {
    if (onPart) onPart(i + 1, plan.length);
    const opt = { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: reportBody(d, m.token, sid, plan, i) };
    let res = null;
    if (!unc) {
      try { res = await rpFetch(m.url, opt, RP_TIMEOUT); }
      catch (e) {
        if (e && (e.message === "timeout" || e.message === "cancel")) throw e;        // 時間切れでは送り直さない（サーバーが処理中かもしれず、重ねると重くなる）
        unc = true;                                                                   // 返事を読めないとき（読み取りが許されない場合を含む）は、読まずに送り直す。届いたかは、あとで保存の確認で調べる
      }
    }
    if (unc) { await rpFetch(m.url, Object.assign({}, opt, { mode: "no-cors" }), RP_TIMEOUT); continue; }
    if (!res.ok) throw new Error("http");
    let j; try { j = await res.json(); } catch (e) { throw new Error("html"); }   // JSONでない（承認ページ・エラーページ・古いスクリプト）
    if (!j || typeof j !== "object") throw new Error("format");
    if (j.ok !== true) throw new Error(j.error === "token" ? "token" : j.error === "size" || j.error === "data" ? "data" : j.error === "busy" ? "busy" : j.error === "order" ? "order" : j.error === "server" ? "server" : "format");
    rows = j.rows;
  }
  return { unc, rows };
}
// 問い合わせ（status。軽い1回。記録の中身は返らない）。種類：ok（新しいスクリプト）／old（古い）／html（承認ページなど、JSONでない）／token／http／none（応答なし）
async function rpProbe(month, sid, ms) {
  const m = state.mail;
  rpCtl = new AbortController(); rpWhy = "";
  let res;
  try { res = await rpFetch(m.url + "?action=status&days=1&month=" + encodeURIComponent(month || "") + "&sid=" + encodeURIComponent(sid || "") + "&token=" + encodeURIComponent(m.token), {}, ms); }
  catch (e) { return { kind: "none" }; }
  if (!res.ok) return { kind: "http" };
  let j; try { j = JSON.parse(await res.text()); } catch (e) { return { kind: "html" }; }
  if (!j || typeof j !== "object") return { kind: "html" };
  if (j.ok === false) return { kind: j.error === "token" ? "token" : "old" };
  return j.ok === true && typeof j.version === "string" && Number(j.version) >= RP_MIN_VERSION ? { kind: "ok", j } : { kind: "old" };
}
// 保存できたかの確認。true=保存済み、false=未保存、null=確認できない
async function rpStatus(month, sid) {
  const r = await rpProbe(month, sid, RP_STATUS_TIMEOUT);
  return r.kind === "ok" && typeof r.j.saved === "boolean" ? r.j.saved : null;
}
const RP_DIAG = {
  old: "古いスクリプトです。スクリプトをコピーし直して貼り替え、新バージョンでデプロイしてください。",
  html: "許可が必要か、デプロイが古い可能性があります。エディタで authorizeReport を実行し、新バージョンでデプロイしてください。",
  token: "合言葉が違います。スクリプトをコピーし直して貼り替えてください。",
  http: "つながりましたが、受け付けられません。URLと、デプロイの「アクセスできるユーザー」を確認してください。",
  none: "応答がありません。通信状況とURLを確認してください。",
};
async function rpCheck() {
  if (rpBusy) return;
  if (!mailReady()) { rpMsg(rpErrText(new Error("setup"))); return; }
  rpBusy = rpChecking = true; $("rpSend").disabled = $("rpCheck").disabled = true; rpMsg("確かめています...");
  try {
    const r = await rpProbe("", "", 20000);
    if (r.kind !== "ok") rpMsg(RP_DIAG[r.kind]);
    else rpMsg("新しいスクリプトです（版 " + r.j.version + "）。" + (r.j.lastMonth ? "保存済み：" + r.j.lastMonth + "・" + r.j.rows + "件" : "まだ保存はありません。"));
  } finally { rpBusy = rpChecking = false; rpCtl = null; $("rpCheck").disabled = false; renderReport(); }
}
const rpErrText = (e) => ({
  setup: "メール連携のURLと合言葉を、先に設定してください。",
  token: "合言葉が合いません。スクリプトをコピーし直して貼り替えてください。",
  timeout: "時間がかかりました。スプレッドシートに保存されたか確認してください（「接続を確かめる」でも調べられます）。",
  html: RP_DIAG.html,
  cancel: "中止しました。",
  busy: "ほかの保存中です。あとでもう一度試してください。",
  order: "保存の順番が合いませんでした。もう一度試してください。",
  server: "スクリプトでエラーになりました。スクリプトをコピーし直し、新バージョンでデプロイして、許可を与えてください。",
  format: "スクリプトが古いか、URLが違います。スクリプトをコピーし直し、新バージョンでデプロイしてください。",
  http: "送れませんでした。URLと、デプロイの「アクセスできるユーザー」を確認してください。",
  data: "内容が受け付けられませんでした。",
}[e && e.message] || "接続できませんでした。通信状況を確認してください。");

// ---- 実行 ----
async function sendReport(month, manual) {
  if (rpBusy) return;
  if (!mailReady()) { rpMsg(rpErrText(new Error("setup"))); return; }
  const d = reportBuild(month, rp.anon);
  if (!d.tx.length) {                                              // 記録のない月は、通信しないで済みにする
    if (!manual) { rp.last = month > rp.last ? month : rp.last; rp.dm = month; rp.n = 0; rp.at = Date.now(); rp.unc = false; rpPersist(); renderReport(); } else rpMsg("この月の記録はありません。送りません。");
    return;
  }
  if (reportOver(d)) { rpBlocked = true; rpMsg("件数が多すぎて送れません（取引" + REPORT_MAX_TX + "件・品目" + REPORT_MAX_ITEMS + "件まで）。"); return; }
  rpBusy = true; rpHold = false; rpTryAt = Date.now(); if (manual) rpBlocked = false;
  const sid = rpSid(), done = (unc) => { if (month > rp.last) rp.last = month; rp.dm = month; rp.n = d.tx.length; rp.at = Date.now(); rp.unc = unc; rpPersist(); };
  $("rpSend").textContent = "中止"; rpMsg("送信中...");
  try {
    const pr = await rpProbe(month, "", RP_STATUS_TIMEOUT);                              // 送る前に、スクリプトの版を1回確かめる（古ければ送らない）
    if (pr.kind !== "ok") {
      if (rpWhy === "cancel") { rpHold = true; rpMsg(rpErrText(new Error("cancel"))); }
      else { if (pr.kind !== "none") rpBlocked = true; rpMsg(pr.kind === "none" ? rpErrText(null) : RP_DIAG[pr.kind]); }
      return;
    }
    const r = await postReport(d, sid, (i, n) => { if (n > 1) rpMsg("送信中... " + i + "/" + n); });
    if (r.unc && (await rpStatus(month, sid)) === true) r.unc = false;                // 返事を読めなかったときは、保存の確認で確かめる
    done(r.unc);
    rpMsg(r.unc ? "送りました（結果は確認できません。スプレッドシートで確かめてください）" : "送りました");
  } catch (e) {
    if (e && (e.message === "timeout" || e.message === "cancel")) {
      rpHold = true;                                                                  // 時間切れ・中止のあとは、このセッションでは自動で送り直さない
      if (e.message === "timeout" && (await rpStatus(month, sid)) === true) { done(false); rpMsg("送りました（保存を確認しました）"); }
      else rpMsg(rpErrText(e));
    } else {
      if (e && ["setup", "token", "format", "html", "http", "data", "server"].includes(e.message)) rpBlocked = true;   // 設定の誤りは、直すまで自動では繰り返さない
      rpMsg(rpErrText(e));
    }
  } finally { rpBusy = false; rpCtl = null; renderReport(); }
}
// 起動したとき・戻ったときに、月が替わっていて先月分をまだ送っていなければ、1回だけ送る
function autoReport() {
  if (!rp.on || rpBlocked || rpHold || rpBusy || document.hidden || !mailReady()) return;
  if (navigator.onLine === false || (navigator.connection && navigator.connection.saveData)) return;     // 通信できないとき・データ節約中は、通信しない
  if (Date.now() - rpTryAt < RP_RETRY) return;
  const m = reportDue(rp, todayStr());
  if (m) sendReport(m, false);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) autoReport(); });

// ---- 画面 ----
const rpMonthName = (m) => Number(m.slice(5, 7)) + "月";
function rpData(m) {
  const k = m + "|" + rp.anon;
  if (!rpCache || rpCache.k !== k) rpCache = { k, d: reportBuild(m, rp.anon) };
  return rpCache.d;
}
function drawReport() {
  const m = $("rpMonth").value, d = rpData(m), s = d.summary, ready = mailReady(), last = m === reportMonths(todayStr())[0], nm = last ? "先月" : rpMonthName(m);
  const ex = reportSamples(d, 3).map((x) => esc(x.s)).join("、");
  $("rpPrev").innerHTML = "<div>" + s.count + "件・品目" + s.itemCount + "件・合計 " + yen(s.total) + (ex ? "<br>店名の例：" + ex : "") + "</div>";
  setSeg($("rpAnonSeg"), (b) => (b.dataset.a === "1") === rp.anon);
  setSeg($("rpAutoSeg"), (b) => (b.dataset.a === "1") === rp.on);
  delete $("rpSend").dataset.armed;
  $("rpCopy").textContent = nm + "のレポート用データをコピー";
  $("rpSend").textContent = rpBusy && !rpChecking ? "中止" : "今すぐ送る（" + nm + "分）"; $("rpSend").disabled = !ready || rpChecking; $("rpCheck").disabled = rpChecking;
  $("rpNeed").textContent = ready ? "" : "先に、設定の「メールから自動取り込み」でURLを設定し、スクリプトをコピーしてください。";
  $("rpLast").textContent = rp.dm ? "前回：" + rpMonthName(rp.dm) + "分・" + rp.n + "件" + (rp.unc ? "（結果は未確認）" : "") : "";
  syncPickers();
}
function renderReport() {
  $("rpSummary").textContent = rp.on ? "自動送信オン" : "オフ";
  if (!$("reportOverlay").hidden) drawReport();
}
$("openReport").onclick = () => {
  rpCache = null;
  fillOptions("rpMonth", reportMonths(todayStr()).map((m, i) => [m, m.slice(0, 4) + "年" + rpMonthName(m) + (i ? "" : "（先月）")]));
  $("rpMonth").value = reportMonths(todayStr())[0];
  rpMsg(""); $("rpText").hidden = true; $("rpOnBox").hidden = true; rpBlocked = false;
  openOv("reportOverlay"); drawReport();
};
$("rpMonth").onchange = () => { $("rpText").hidden = true; rpMsg(""); drawReport(); };
$("rpAnonSeg").onclick = (e) => { const b = e.target.closest("[data-a]"); if (b) { rp.anon = b.dataset.a === "1"; rpPersist(); $("rpText").hidden = true; drawReport(); } };
$("rpCopy").onclick = async () => {
  const d = rpData($("rpMonth").value);
  if (!d.tx.length) { rpMsg("この月の記録はありません。"); return; }
  const text = reportText(d), ta = $("rpText");
  try { await navigator.clipboard.writeText(text); toast("コピーしました（" + d.tx.length + "件）"); ta.hidden = true; }
  catch (e) { ta.value = text; ta.hidden = false; ta.focus(); ta.select(); toast("下の文字を全部選んでコピーしてください"); }
};
$("rpAutoSeg").onclick = (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  if (b.dataset.a === "1") {
    if (rp.on) return;
    if (!mailReady()) { rpMsg("先に、メール連携のURLと合言葉を設定してください。"); return; }   // 未設定のときはオンにできない
    $("rpOnText").textContent = RP_ON_TEXT; $("rpOnBox").hidden = false;                  // 送る内容を見せて、確認してからオンにする
  } else { rp.on = false; $("rpOnBox").hidden = true; rpPersist(); renderReport(); }
};
$("rpOnNo").onclick = () => { $("rpOnBox").hidden = true; };
$("rpOnOk").onclick = () => { rp.on = true; rpBlocked = false; $("rpOnBox").hidden = true; rpPersist(); rpMsg(""); renderReport(); toast("月次の自動送信をオンにしました"); };
$("rpCheck").onclick = rpCheck;
$("rpSend").onclick = () => {
  if (rpBusy) { rpWhy = "cancel"; if (rpCtl) rpCtl.abort(); return; }                // 送信中は「中止」
  if (!armed($("rpSend"), "もう一度押すと、送ります")) return;
  sendReport($("rpMonth").value, true);
};
