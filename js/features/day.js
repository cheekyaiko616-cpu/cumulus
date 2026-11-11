"use strict";
// ===== 日ごとの記録 =====
let dayKey = "";
function entryHtml(e, withDate) {
  const d = parseKey(e.date);
  const items = e.items.map((i) => esc(i.n) + " " + comma(i.p)).join("、");
  return '<button type="button" class="item" data-entry="' + esc(e.id) + '"><span class="l">' + (withDate ? '<span class="num">' + (d.getMonth() + 1) + "/" + d.getDate() + "</span>　" : "") + esc(e.store || "お店の名前なし") +
    '<span class="chip" style="color:' + payColor(e) + '">' + esc(payLabel(e)) + "</span>" + (e.src === "mail" ? '<span class="chip">' + (e.rc ? "メール・レシート" : "メール") + "</span>" : "") + "<small>" + items + '</small></span><span class="r">' + yen(e.total) + "</span></button>";
}
// その日に引き落とされるカード代
function payNotes(k) {
  const past = k < todayStr();
  return (paysByDate[k] || []).map((p) => '<div class="note paynote"><span aria-hidden="true">💳</span><span><b>' + esc(p.card) + "</b> が <b>" + yen(p.amount) + "</b> " + (past ? "引き落とされました" : "引き落とされます") +
    "<small>" + mdShort(p.from) + "〜" + mdShort(p.to) + "のご利用 " + p.count + "件分</small></span></div>").join("");
}
function renderDay() {
  const d = parseKey(dayKey), list = byDate[dayKey] || [];
  $("dayTitle").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日（" + WD[d.getDay()] + "）";
  let html = "";
  if (list.length) html = list.map((e) => entryHtml(e, false)).join("") + '<div class="total" style="margin-top:6px"><span>この日の合計</span><span class="num">' + yen(spentOn(dayKey)) + "</span></div>";
  else if (isSavedDay(dayKey)) html = '<div class="note"><span class="bag" aria-hidden="true">💰</span><span>この日は何も買わなかったので、<b>' + yen(state.daily) + "</b> を投資資金に記録しました。</span></div>";
  else if (dayKey === todayStr()) html = '<div class="note"><span>今日はまだ何も買っていません。このまま1日を終えると <b>' + yen(state.daily) + "</b> が投資資金に加わります。</span></div>";
  else html = '<div class="empty">' + (dayKey < state.start ? "数え始める日より前の日です。" : "まだ来ていない日です。") + "</div>";
  $("dayBody").innerHTML = payNotes(dayKey) + html;
}
function openDay(k) { dayKey = k; renderDay(); openOv("dayOverlay"); }
$("dayPrev").onclick = () => { dayKey = addDays(dayKey, -1); renderDay(); };
$("dayNext").onclick = () => { dayKey = addDays(dayKey, 1); renderDay(); };
$("dayAdd").onclick = () => openEdit(null, dayKey);
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]"); if (c) { closeOv(c.dataset.close); return; }
  const iv = e.target.closest("[data-inv]");
  if (iv) { const v = state.invests.find((x) => x.id === iv.dataset.inv); if (v) openInv(v); return; }
  const en = e.target.closest("[data-entry]");
  if (en) { const ent = state.entries.find((x) => x.id === en.dataset.entry); if (ent) openEdit(ent); return; }
  // 外側を押して閉じるのは「日ごとの記録」と「年月」だけ。入力画面は入力が消えてしまうので閉じない
  if (e.target.id === "dayOverlay" || e.target.id === "monthOverlay") closeOv(e.target.id);
});
