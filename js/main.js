"use strict";
// ===== 画面（タブ）の切り替え・起動 =====
// 役割: タブの切り替え、見えている画面だけを描く仕組み、保存したあとの描き直し、日付が変わったときの更新、各画面をつなぐ操作（今日・一覧の行を押す）、起動
// 依存: util.js, model.js, storage.js, stats.js, dom.js, tab-swipe.js, calendar.js, invest.js, summary.js, settings.js, cards.js, mail.js
// 実行時: edit.js, backup.js
// 公開: RENDER, tab, dirty, showTab, renderAll, lastToday, midnightTimer, refreshIfNewDay, scheduleMidnight

const TITLES = { invest: "投資", summary: "まとめ", settings: "設定" };
const RENDER = { calendar: renderCalendar, invest: renderInvest, summary: renderSummary, settings: () => { renderSettings(); renderCards(); renderMail(); renderBackup(); } };
let tab = "calendar";
const dirty = new Set(Object.keys(RENDER));                         // 描き直しが必要な画面。見えていない画面は、開くまで描かない（電池の節約）
const renderTab = (t) => { if (dirty.delete(t)) RENDER[t](); };
function showTab(name) {
  tab = name;
  ["calendar", "invest", "summary", "settings"].forEach((t) => { $("view-" + t).hidden = t !== name; });
  document.querySelectorAll("nav.tabs [data-tab]").forEach((b) => { if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  const cal = name === "calendar";
  document.querySelectorAll(".cal-only").forEach((el) => { el.hidden = !cal; });
  $("todayBtn").hidden = name === "settings";
  $("pageTitle").hidden = cal; $("pageTitle").textContent = TITLES[name] || "";
  $("main").classList.toggle("fit", cal);                         // カレンダーだけは1画面に収める（スクロールなし）
  $("main").scrollTop = 0;
  renderTab(name);
}
// 拡大しない：iPhoneのSafariは viewport の user-scalable=no を無視するので、ピンチの開始を止める（指2本のときだけ起きる出来事なので、スクロールの邪魔にならない）
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.querySelector("nav.tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); };
// 左右のスワイプでとなりの画面へ（タブの並び順。カレンダーからは動かない）
initTabSwipe(["calendar", "invest", "summary", "settings"], () => tab, showTab);
$("goInvest").onclick = () => showTab("invest");

function renderAll() {
  $("sampleBar").hidden = !state.sample;
  $("storeWarn").hidden = storageOk;
  Object.keys(RENDER).forEach((t) => dirty.add(t));
  renderTab(tab);
}
onSaved = () => renderAll();                                       // 保存したあとは、見えている画面を描き直す（storage.js の save が呼ぶ）

// ---- 画面をつなぐ操作 ----
// 「今日」：カレンダー・まとめ・投資の表示を、今日の月に戻す
$("todayBtn").onclick = () => { const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); sumAnchor = todayStr(); invAnchor = todayStr(); renderAll(); };
// 一覧の行を押したら、買い物・投資の入力画面で直す
document.addEventListener("click", (e) => {
  const iv = e.target.closest("[data-inv]");
  if (iv) { const v = state.invests.find((x) => x.id === iv.dataset.inv); if (v) openInv(v); return; }
  const en = e.target.closest("[data-entry]");
  if (en) { const ent = state.entries.find((x) => x.id === en.dataset.entry); if (ent) openEdit(ent); }
});

// ---- 日付が変わったら（開いたままにしていた場合）、今日に合わせて表示し直す ----
// 1分ごとの確認はしない。次の0時に1回だけ動くタイマーを置き、画面が見えていない間は止める
let lastToday = todayStr(), midnightTimer = 0;
function refreshIfNewDay() {
  const t = todayStr();
  if (t === lastToday) return;
  lastToday = t; const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); sumAnchor = t; invAnchor = t; renderAll();
}
function scheduleMidnight() {
  clearTimeout(midnightTimer);
  if (document.hidden) return;
  const n = new Date();
  midnightTimer = setTimeout(() => { refreshIfNewDay(); scheduleMidnight(); }, new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5) - n);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(midnightTimer); else { refreshIfNewDay(); scheduleMidnight(); } });
scheduleMidnight();

// ---- 起動 ----
state = load(); reindex();
{ const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); }
renderAll();
showTab("calendar");
autoMail();                                                       // メール連携の設定があれば、新しい利用明細を調べる
