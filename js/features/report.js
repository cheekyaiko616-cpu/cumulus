"use strict";
// ===== 月次レポート（コピーと自動送信） =====
// 役割: 設定の「月次レポート」。先月（または選んだ月）のレポート用データをコピーする、月が替わった最初の起動で先月分をGoogleスプレッドシートへ1回だけ送る（連携のURLへPOST）。通信は、この送信と手動の操作だけ。タイマー・定期取得はない
// 依存: util.js, model.js, mail-plan.js, report-data.js, storage.js, dom.js, overlay.js, picker.js
// 実行時: なし
// 公開: rp, rpBlocked, rpTryAt, rpBusy, rpClear, postReport, sendReport, autoReport, renderReport

const RP_RETRY = 10 * 60 * 1000;                                  // 失敗したあと、自動で試し直すまでの下限（10分）
let rp = normReport(readKey(KEY_RP));                             // 設定（別のキーに保存。記録のデータの形は変えない）
let rpBlocked = false, rpTryAt = 0, rpBusy = false;               // rpBlocked：URL・合言葉・スクリプトの誤りで失敗したあとは、直るまで自動では試さない
let rpCache = null;
const rpPersist = () => { tryWrite(KEY_RP, JSON.stringify(rp)); };
function rpClear() { rp = normReport(null); dropKey(KEY_RP); rpCache = null; rpMsg(""); renderReport(); }
const rpMsg = (t) => { $("rpMsg").textContent = t || ""; };
const RP_ON_TEXT = "毎月、先月の取引の全件（日付・店名・金額・支払い・カード名・登録方法・品目・月の集計・投資の日付と金額）を、あなたのGoogleスプレッドシートに送ります。支店名・メモ・写真・URL・合言葉・長い数字は送りません。品名に書いた内容はそのまま含まれます。";

// ---- 送信（通信） ----
// 送り先は、メール連携と同じURL（https://script.google.com/…/exec）だけ。本文はテキストのまま（text/plain。事前確認の通信が要らない）。合言葉は本文に入れ、URLには付けない。同じ月は上書きされるので、送り直しても重複しない
async function postReport(d) {
  const m = state.mail;
  if (!mailReady()) throw new Error("setup");
  const body = reportBody(d, m.token), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
  const opt = { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, signal: ctl.signal, credentials: "omit", cache: "no-store", redirect: "follow" };
  try {
    let res;
    try { res = await fetch(m.url, opt); }
    catch (e) {
      if (e && e.name === "AbortError") throw new Error("timeout");
      await fetch(m.url, Object.assign({}, opt, { mode: "no-cors" }));   // 返事を読めないとき（読み取りが許されない場合を含む）は、読まずに送り直す。届いたかはスプレッドシートで確かめる
      return { unc: true };
    }
    if (!res.ok) throw new Error("http");
    let j; try { j = await res.json(); } catch (e) { throw new Error("format"); }
    if (!j || typeof j !== "object") throw new Error("format");
    if (j.ok !== true) throw new Error(j.error === "token" ? "token" : j.error === "size" || j.error === "data" ? "data" : "format");
    return { unc: false, rows: j.rows };
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally { clearTimeout(timer); }
}
const rpErrText = (e) => ({
  setup: "メール連携のURLと合言葉を、先に設定してください。",
  token: "合言葉が合いません。スクリプトをコピーし直して貼り替えてください。",
  timeout: "時間がかかったので止めました。もう一度試してください。",
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
  rpBusy = true; rpTryAt = Date.now(); if (manual) rpBlocked = false; $("rpSend").disabled = true; rpMsg("送っています…");
  try {
    const r = await postReport(d);
    if (month > rp.last) rp.last = month;
    rp.dm = month; rp.n = d.tx.length; rp.at = Date.now(); rp.unc = r.unc; rpPersist();
    rpMsg(r.unc ? "送りました（結果は確認できません。スプレッドシートで確かめてください）" : "送りました");
  } catch (e) {
    if (e && ["setup", "token", "format", "http", "data"].includes(e.message)) rpBlocked = true;   // 設定の誤りは、直すまで自動では繰り返さない
    rpMsg(rpErrText(e));
  } finally { rpBusy = false; $("rpSend").disabled = !mailReady(); renderReport(); }
}
// 起動したとき・戻ったときに、月が替わっていて先月分をまだ送っていなければ、1回だけ送る
function autoReport() {
  if (!rp.on || rpBlocked || rpBusy || document.hidden || !mailReady()) return;
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
  $("rpSend").textContent = "今すぐ送る（" + nm + "分）"; $("rpSend").disabled = !ready || rpBusy;
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
$("rpSend").onclick = () => {
  if (!armed($("rpSend"), "もう一度押すと、送ります")) return;
  sendReport($("rpMonth").value, true);
};
