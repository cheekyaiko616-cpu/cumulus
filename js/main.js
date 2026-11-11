"use strict";
// ===== 画面（タブ）の切り替え・起動 =====
const TITLES = { invest: "投資", summary: "まとめ", settings: "設定" };
const RENDER = { calendar: renderCalendar, invest: renderInvest, summary: renderSummary, settings: () => { renderSettings(); renderMail(); } };
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
document.querySelector("nav.tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); };
$("goInvest").onclick = () => showTab("invest");

function renderAll() {
  $("sampleBar").hidden = !state.sample;
  $("storeWarn").hidden = storageOk;
  Object.keys(RENDER).forEach((t) => dirty.add(t));
  renderTab(tab);
}
let toastT = 0;
function toast(msg) {
  const t = $("toastEl"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2400);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openStack.length) closeOv(openStack[openStack.length - 1]); });

// 日付が変わったら（開いたままにしていた場合）、今日に合わせて表示し直す
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

state = load(); reindex();
{ const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); }
renderAll();
showTab("calendar");
autoMail();                                                       // メール連携の設定があれば、新しい利用明細を調べる
